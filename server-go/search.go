package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// GO BROWSER CORE — GOOGLE SEARCH SUPPORT
// ============================================================================
//
// WHY THERE IS NO SERVER-SIDE RESULT SCRAPER ANYMORE
// ---------------------------------------------------
// The previous design fetched each search engine's HTML from the Go server and
// scraped result links out of it. That approach CANNOT work for Google, and
// the failure mode was silent:
//
//   * Google answers a non-browser HTTP client with a JavaScript-only shell
//     (the body contains /httpservice/retry/enablejs and zero result markup).
//     Verified on this host: 94 KB of shell, 0 result anchors.
//   * The old proxy then concluded "this engine has no results" and quietly
//     re-served DuckDuckGo HTML under Google's name. That is exactly the bug
//     the user reported: "I picked Google/Brave/Bing, DuckDuckGo loaded".
//
// A real Chromium engine rendering google.com/search?igu=1 inside an iframe
// DOES show the full result list (verified with a headed Chrome + CDP: the
// page rendered YouTube, Google Play and Wikipedia results with a knowledge
// panel). The difference is the browser engine, not the headers.
//
// Therefore the browser now renders pages DIRECTLY in its iframe and only
// uses this module for the two things a server can legitimately provide:
//
//   1. Search SUGGESTIONS (Google's autocomplete endpoint is a plain JSON
//      API that works from any client — verified).
//   2. Redirect unpacking, so a result link resolves to its true destination
//      before the browser navigates to it.
//
// The search page itself is never fetched or parsed by Go. Nothing about a
// result is invented: the browser shows Google's own rendered page.
// ============================================================================

const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// googleSearchURL builds the URL the browser navigates to for a query.
//
// igu=1 is Google's own "embeddable" flag: it is what lets a Google results
// page render inside an iframe (the normal results page sends
// X-Frame-Options: SAMEORIGIN and refuses to be framed).
func googleSearchURL(query string) string {
	return "https://www.google.com/search?igu=1&q=" + url.QueryEscape(query)
}

// googleSuggestURL builds the autocomplete endpoint URL.
func googleSuggestURL(query string) string {
	return "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=" + url.QueryEscape(query)
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

var googleHTTPClient = &http.Client{
	Timeout: 12 * time.Second,
	Transport: &http.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout:   6 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          40,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   6 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    false,
	},
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

type suggestCacheEntry struct {
	items []string
	until time.Time
}

type SuggestCache struct {
	mu    sync.Mutex
	items map[string]suggestCacheEntry
}

func NewSuggestCache() *SuggestCache {
	return &SuggestCache{items: map[string]suggestCacheEntry{}}
}

// Suggestions returns Google's autocomplete suggestions for a query.
func (c *SuggestCache) Suggestions(r *http.Request, query string) []string {
	query = strings.TrimSpace(query)
	if len(query) < 2 {
		return []string{}
	}
	key := strings.ToLower(query)

	c.mu.Lock()
	if e, ok := c.items[key]; ok && time.Now().Before(e.until) {
		c.mu.Unlock()
		return e.items
	}
	c.mu.Unlock()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, googleSuggestURL(query), nil)
	if err != nil {
		return []string{}
	}
	req.Header.Set("User-Agent", chromeUA)
	req.Header.Set("Accept", "application/json,text/plain,*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := googleHTTPClient.Do(req)
	if err != nil {
		return []string{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return []string{}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return []string{}
	}

	items := parseGoogleSuggest(string(body))

	c.mu.Lock()
	c.items[key] = suggestCacheEntry{items: items, until: time.Now().Add(5 * time.Minute)}
	c.mu.Unlock()
	return items
}

// parseGoogleSuggest reads the Firefox-style autocomplete payload:
//   ["query",["sug1","sug2",...],[],{...}]
func parseGoogleSuggest(body string) []string {
	var raw []json.RawMessage
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return []string{}
	}
	if len(raw) < 2 {
		return []string{}
	}
	var list []string
	if err := json.Unmarshal(raw[1], &list); err != nil {
		return []string{}
	}
	out := make([]string, 0, len(list))
	seen := map[string]bool{}
	for _, s := range list {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// ---------------------------------------------------------------------------
// Redirect unpacking
// ---------------------------------------------------------------------------

var (
	bingURep = regexp.MustCompile(`(?i)&[a-z_]*u=a1([a-zA-Z0-9_\-=+/%]+)`)
	base64Re  = regexp.MustCompile(`[^A-Za-z0-9+/=]`)
)

// UnwrapRedirect resolves a search-engine redirect wrapper to the real
// destination URL. Google result links use /url?q=<target>; Bing uses
// /ck/a?...&u=a1<base64>; DuckDuckGo uses /l/?uddg=<target>; Yahoo uses
// /RU=<target>. Anything already absolute and unwrapped is returned as-is.
func UnwrapRedirect(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return s
	}
	s = strings.ReplaceAll(s, "&amp;", "&")
	if strings.HasPrefix(s, "//") {
		s = "https:" + s
	}

	// DuckDuckGo: /l/?uddg=<percent-encoded>
	if strings.Contains(s, "/l/?") && strings.Contains(s, "uddg=") {
		if u, err := url.Parse(s); err == nil {
			if d := u.Query().Get("uddg"); d != "" {
				return UnwrapRedirect(d)
			}
		}
	}

	// Google: /url?q=<target>
	if strings.Contains(s, "/url?") {
		if u, err := url.Parse(s); err == nil {
			if d := u.Query().Get("q"); d != "" {
				return UnwrapRedirect(d)
			}
			if d := u.Query().Get("url"); d != "" {
				return UnwrapRedirect(d)
			}
		}
	}

	// Bing: /ck/a?...&u=a1<base64url>
	if strings.Contains(s, "/ck/a") {
		if m := bingURep.FindStringSubmatch(s); len(m) == 2 {
			if decoded, ok := decodeBingParam(m[1]); ok {
				return UnwrapRedirect(decoded)
			}
		}
	}

	// Yahoo: /RU=<percent-encoded>
	if idx := strings.Index(s, "/RU="); idx != -1 {
		sub := s[idx+4:]
		if end := strings.Index(sub, "/"); end != -1 {
			sub = sub[:end]
		}
		if unesc, err := url.QueryUnescape(sub); err == nil {
			if strings.HasPrefix(unesc, "http://") || strings.HasPrefix(unesc, "https://") {
				return unesc
			}
		}
	}

	return s
}

// decodeBingParam decodes Bing's a1-prefixed base64url parameter.
func decodeBingParam(enc string) (string, bool) {
	s := strings.ReplaceAll(enc, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")
	s = base64Re.ReplaceAllString(s, "")
	for len(s)%4 != 0 {
		s += "="
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "="))
		if err != nil {
			return "", false
		}
	}
	if len(raw) == 0 {
		return "", false
	}
	out := strings.TrimPrefix(string(raw), "a1")
	if strings.HasPrefix(out, "http://") || strings.HasPrefix(out, "https://") {
		return out, true
	}
	return "", false
}

// YouTubeVideoID extracts the 11-character video id from any YouTube URL
// form (watch, short link, shorts, live, embed) or returns "".
func YouTubeVideoID(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	path := u.Path

	if strings.Contains(host, "youtu.be") {
		id := strings.Trim(path, "/")
		if i := strings.Index(id, "/"); i > 0 {
			id = id[:i]
		}
		if len(id) == 11 {
			return id
		}
		return ""
	}
	if strings.Contains(host, "youtube.com") {
		if v := u.Query().Get("v"); len(v) == 11 {
			return v
		}
		for _, p := range []string{"/embed/", "/shorts/", "/live/", "/v/"} {
			if strings.HasPrefix(path, p) {
				id := strings.Trim(strings.TrimPrefix(path, p), "/")
				if i := strings.Index(id, "/"); i > 0 {
					id = id[:i]
				}
				if len(id) == 11 {
					return id
				}
			}
		}
	}
	return ""
}

// YouTubeEmbedURL converts a YouTube video URL into its embeddable form.
// The nocookie host is used because www.youtube.com/embed refuses to start
// inside a non-YouTube embedder ("Error 152 - 4").
func YouTubeEmbedURL(rawURL string) string {
	id := YouTubeVideoID(rawURL)
	if id == "" {
		return ""
	}
	return fmt.Sprintf("https://www.youtube-nocookie.com/embed/%s?autoplay=1&rel=0&playsinline=1", id)
}

// IsYouTubeHost reports whether a URL points at any YouTube property.
func IsYouTubeHost(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return strings.Contains(host, "youtube.com") ||
		strings.Contains(host, "youtube-nocookie.com") ||
		strings.Contains(host, "youtu.be")
}
