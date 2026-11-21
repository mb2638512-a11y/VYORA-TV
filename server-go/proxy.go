package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var bufferPool = sync.Pool{
	New: func() interface{} {
		buf := make([]byte, 64*1024) // 64KB zero-copy buffer
		return &buf
	},
}

// firstByteTimeout is how long a route may answer with headers but deliver
// nothing. Such a route is dropped so the other one can win the race.
const firstByteTimeout = 2500 * time.Millisecond

type cachedManifest struct {
	content    []byte
	expires    time.Time
	staleUntil time.Time
}

type cachedSegment struct {
	content     []byte
	contentType string
	expires     time.Time
}

type ProxyManager struct {
	client        *http.Client
	directClient  *http.Client
	tunnelClient  *http.Client
	manifestCache sync.Map // string -> *cachedManifest
	segmentCache  sync.Map // string -> *cachedSegment
	logosDir      string
	health        *HealthStore
	warmSem       chan struct{} // background warm-ups (keep the bandwidth free)
	warmFastSem   chan struct{} // user initiated warm-ups (hover / focus) jump the queue
	bwMu          sync.Mutex
	bwKbps        float64
	bwSamples     int
	bwLast        time.Time
}

func NewProxyManager(logosDir string, health *HealthStore) *ProxyManager {
	_ = os.MkdirAll(logosDir, 0755)

	directTransport := &http.Transport{
		Proxy: nil, // DIRECT CONNECTION
		DialContext: (&net.Dialer{
			Timeout:   3000 * time.Millisecond,
			KeepAlive: 60 * time.Second,
		}).DialContext,
		MaxIdleConns:          1000,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   3000 * time.Millisecond,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
			NextProtos:         []string{"http/1.1"},
		},
		TLSNextProto: make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}
	directClient := &http.Client{
		Transport: directTransport,
		Timeout:   40 * time.Second,
	}

	proxyURL, _ := url.Parse("http://127.0.0.1:8080")
	tunnelTransport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL), // LOCAL TUNNEL PROXY
		DialContext: (&net.Dialer{
			Timeout:   5000 * time.Millisecond,
			KeepAlive: 60 * time.Second,
		}).DialContext,
		MaxIdleConns:          1000,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   6000 * time.Millisecond,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
			NextProtos:         []string{"http/1.1"},
		},
		TLSNextProto: make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}
	tunnelClient := &http.Client{
		Transport: tunnelTransport,
		Timeout:   40 * time.Second,
	}

	pm := &ProxyManager{
		client:       directClient,
		directClient: directClient,
		tunnelClient: tunnelClient,
		logosDir:     logosDir,
		health:       health,
		warmSem:      make(chan struct{}, 6),
		warmFastSem:  make(chan struct{}, 4),
	}

	go pm.cleanCaches()
	return pm
}

func (pm *ProxyManager) cleanCaches() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		pm.manifestCache.Range(func(key, value interface{}) bool {
			if cm, ok := value.(*cachedManifest); ok && now.After(cm.expires) {
				pm.manifestCache.Delete(key)
			}
			return true
		})
		pm.segmentCache.Range(func(key, value interface{}) bool {
			if cs, ok := value.(*cachedSegment); ok && now.After(cs.expires) {
				pm.segmentCache.Delete(key)
			}
			return true
		})
	}
}

func encodeParam(val string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(val))
}

func decodeParam(val string) string {
	if val == "" {
		return ""
	}
	// Direct URL check
	if strings.HasPrefix(val, "http://") || strings.HasPrefix(val, "https://") {
		return val
	}
	// 1. Try RawURLEncoding (unpadded URL-safe)
	if data, err := base64.RawURLEncoding.DecodeString(val); err == nil {
		s := string(data)
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			return s
		}
	}
	// 2. Try standard URLEncoding
	if data, err := base64.URLEncoding.DecodeString(val); err == nil {
		s := string(data)
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			return s
		}
	}
	// 3. Try RawStdEncoding
	if data, err := base64.RawStdEncoding.DecodeString(val); err == nil {
		s := string(data)
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			return s
		}
	}
	// 4. Try standard StdEncoding
	if data, err := base64.StdEncoding.DecodeString(val); err == nil {
		s := string(data)
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			return s
		}
	}
	// 5. Try padding with =
	padded := val
	for len(padded)%4 != 0 {
		padded += "="
	}
	if data, err := base64.URLEncoding.DecodeString(padded); err == nil {
		s := string(data)
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			return s
		}
	}
	if data, err := base64.StdEncoding.DecodeString(padded); err == nil {
		s := string(data)
		if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			return s
		}
	}
	return val
}

func buildProxyURL(target, referer, ua, cid string) string {
	params := url.Values{}
	params.Set("u", encodeParam(target))
	if referer != "" {
		params.Set("r", encodeParam(referer))
	}
	if ua != "" {
		params.Set("a", encodeParam(ua))
	}
	if cid != "" {
		params.Set("cid", cid)
	}
	return "/api/proxy?" + params.Encode()
}

func (pm *ProxyManager) synthesizeHeaders(req *http.Request, targetURL, referer, ua string) {
	parsedTarget, err := url.Parse(targetURL)
	targetOrigin := ""
	if err == nil {
		targetOrigin = fmt.Sprintf("%s://%s", parsedTarget.Scheme, parsedTarget.Host)
	}

	userAgent := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
	if ua != "" {
		userAgent = ua
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Connection", "keep-alive")

	if referer != "" {
		req.Header.Set("Referer", referer)
		if refParsed, err := url.Parse(referer); err == nil {
			req.Header.Set("Origin", fmt.Sprintf("%s://%s", refParsed.Scheme, refParsed.Host))
		}
	} else if targetOrigin != "" {
		req.Header.Set("Referer", targetOrigin+"/")
		req.Header.Set("Origin", targetOrigin)
	}
}

var uriAttrRegex = regexp.MustCompile(`URI="([^"]+)"`)

// RewriteHLSPlaylist rewrites all relative/absolute stream URLs to go through the proxy.
func (pm *ProxyManager) RewriteHLSPlaylist(manifestText, baseURLStr, referer, ua, cid string) string {
	baseURL, err := url.Parse(baseURLStr)
	if err != nil {
		return manifestText
	}

	scanner := bufio.NewScanner(strings.NewReader(manifestText))
	var out strings.Builder

	for scanner.Scan() {
		raw := scanner.Text()
		line := strings.TrimSpace(raw)
		if line == "" {
			out.WriteString(raw)
			out.WriteByte('\n')
			continue
		}

		if strings.HasPrefix(line, "#") {
			// Rewrite URI="..." attributes (e.g. #EXT-X-KEY, #EXT-X-MAP)
			if strings.Contains(line, `URI="`) {
				rewritten := uriAttrRegex.ReplaceAllStringFunc(line, func(match string) string {
					sub := uriAttrRegex.FindStringSubmatch(match)
					if len(sub) < 2 {
						return match
					}
					targetUri := sub[1]
					if relURL, err := url.Parse(targetUri); err == nil {
						absURL := baseURL.ResolveReference(relURL).String()
						return fmt.Sprintf(`URI="%s"`, buildProxyURL(absURL, referer, ua, cid))
					}
					return match
				})
				out.WriteString(rewritten)
				out.WriteByte('\n')
				continue
			}
			out.WriteString(raw)
			out.WriteByte('\n')
			continue
		}

		// Media segment or nested playlist URL
		if relURL, err := url.Parse(line); err == nil {
			absURL := baseURL.ResolveReference(relURL).String()
			out.WriteString(buildProxyURL(absURL, referer, ua, cid))
			out.WriteByte('\n')
		} else {
			out.WriteString(raw)
			out.WriteByte('\n')
		}
	}

	return out.String()
}

// ProxyStream handles streaming and manifest forwarding with ultra-low latency.
func (pm *ProxyManager) ProxyStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetURL := decodeParam(q.Get("u"))
	referer := decodeParam(q.Get("r"))
	ua := decodeParam(q.Get("a"))
	cid := q.Get("cid")

	if targetURL == "" {
		http.Error(w, `{"error":"missing ?u="}`, http.StatusBadRequest)
		return
	}

	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Expose-Headers", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	cacheKey := fmt.Sprintf("%s|%s|%s", targetURL, referer, ua)

	// Check manifest cache hit (instant sub-millisecond playback)
	if val, ok := pm.manifestCache.Load(cacheKey); ok {
		if cm, ok := val.(*cachedManifest); ok {
			now := time.Now()
			if now.Before(cm.expires) {
				w.Header().Set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.Header().Set("X-Vyora-Cache", "HIT")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(cm.content)
				return
			}
			if now.Before(cm.staleUntil) {
				// Stale-while-revalidate: serve the warm copy right away (the
				// first segments are already in RAM) and refresh in the back.
				w.Header().Set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.Header().Set("X-Vyora-Cache", "STALE")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(cm.content)
				go pm.Prefetch(targetURL, referer, ua, cid)
				return
			}
		}
	}

	// Check segment cache hit (warm-started segment - sub-millisecond RAM delivery)
	if val, ok := pm.segmentCache.Load(cacheKey); ok {
		if cs, ok := val.(*cachedSegment); ok && time.Now().Before(cs.expires) {
			w.Header().Set("Content-Type", cs.contentType)
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Vyora-Cache", "HIT")
			http.ServeContent(w, r, "segment.ts", time.Time{}, bytes.NewReader(cs.content))
			return
		}
	}

	// Prepare upstream request with dual-racer fallback (eliminates high-latency CDN hangs)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	resp, doErr := pm.fetchWithDualRace(ctx, r.Method, targetURL, referer, ua, r.Header)

	if doErr != nil || resp == nil {
		http.Error(w, fmt.Sprintf(`{"error":"upstream failed: %v"}`, doErr), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "upstream-http-error",
			"status": resp.StatusCode,
		})
		return
	}

	contentType := resp.Header.Get("Content-Type")

	// Detect if this is an HLS playlist (master or media)
	isHLS := strings.Contains(contentType, "mpegurl") ||
		strings.Contains(contentType, "x-mpegURL") ||
		strings.Contains(targetURL, ".m3u8")

	if isHLS {
		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
		trimmedBytes := bytes.TrimPrefix(bodyBytes, []byte("\xef\xbb\xbf")) // Strip UTF-8 BOM
		trimmedBytes = bytes.TrimSpace(trimmedBytes)

		if err == nil && (bytes.Contains(trimmedBytes, []byte("#EXTM3U")) || bytes.Contains(trimmedBytes, []byte("#EXT-X-"))) {
			rewritten := pm.RewriteHLSPlaylist(string(trimmedBytes), targetURL, referer, ua, cid)

			// A master playlist often advertises variants that are already
			// dead. Remove them here so the player does not waste attempts
			// on 404s - and fail over to the next source right away when
			// every variant is dead.
			if pruned, ok := pm.pruneMasterVariants(rewritten, referer, ua); ok {
				rewritten = pruned
			} else {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "all-variants-dead",
				})
				return
			}

			rewrittenBytes := []byte(rewritten)
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(rewrittenBytes)

			// Smart Cache TTL:
			// Master Playlists (#EXT-X-STREAM-INF) describe streams/qualities and are STATIC. Cache for 30 minutes!
			// Live Media Playlists (#EXTINF) contain rolling video chunks. Serve the warm copy
			// for 2s, then keep serving it stale (while refreshing in the background) for 30s -
			// that is what makes the click instant even for rolling live streams.
			// VOD Playlists (#EXT-X-ENDLIST) are static. Cache for 2 hours!
			freshTTL, staleTTL := manifestTTLs(trimmedBytes)

			pm.manifestCache.Store(cacheKey, &cachedManifest{
				content:    rewrittenBytes,
				expires:    time.Now().Add(freshTTL),
				staleUntil: time.Now().Add(staleTTL),
			})

			// Pre-warm the primary child variant in background if master playlist,
			// or pre-warm upcoming video segment in background if media playlist!
			if bytes.Contains(trimmedBytes, []byte("#EXT-X-STREAM-INF")) {
				lines := strings.Split(rewritten, "\n")
				for _, l := range lines {
					l = strings.TrimSpace(l)
					if strings.HasPrefix(l, "/api/proxy?") {
						if parsed, err := url.Parse(l); err == nil {
							subTarget := decodeParam(parsed.Query().Get("u"))
							subRef := decodeParam(parsed.Query().Get("r"))
							subUA := decodeParam(parsed.Query().Get("a"))
							if subTarget != "" && subTarget != targetURL {
								go pm.Prefetch(subTarget, subRef, subUA, cid)
							}
						}
						break
					}
				}
			} else if bytes.Contains(trimmedBytes, []byte("#EXTINF")) {
				lines := strings.Split(rewritten, "\n")
				for _, l := range lines {
					l = strings.TrimSpace(l)
					if strings.HasPrefix(l, "/api/proxy?") {
						if parsed, err := url.Parse(l); err == nil {
							subTarget := decodeParam(parsed.Query().Get("u"))
							subRef := decodeParam(parsed.Query().Get("r"))
							subUA := decodeParam(parsed.Query().Get("a"))
							if subTarget != "" && subTarget != targetURL {
								go pm.PrefetchSegment(subTarget, subRef, subUA)
								break
							}
						}
					}
				}
			}

			// If channel ID provided, mark online in health store
			if cid != "" && pm.health != nil {
				pm.health.Set(cid, "online", 50, "proxy", 0)
			}
			return
		}

		// Not a valid HLS playlist (likely HTML block or corrupt)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "invalid-manifest",
			"details": "Upstream did not return valid HLS #EXTM3U data",
		})
		return
	}

	// For media segments (.ts, .aac, .m4s, .mp4, mp2t) -> Zero-copy high-throughput streaming
	for k, vv := range resp.Header {
		lower := strings.ToLower(k)
		if lower == "content-type" || lower == "content-length" || lower == "content-range" || lower == "accept-ranges" {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)

	bufPtr := bufferPool.Get().(*[]byte)
	defer bufferPool.Put(bufPtr)

	// Measure the real throughput so the app can auto-tune the quality.
	segStart := time.Now()
	written, _ := io.CopyBuffer(w, resp.Body, *bufPtr)
	pm.sampleBandwidth(written, time.Since(segStart))
}

// ---------------------------------------------------------------------
// bandwidth measurement (drives the auto quality)
// ---------------------------------------------------------------------

// sampleBandwidth keeps a rolling estimate of the real stream throughput.
func (pm *ProxyManager) sampleBandwidth(bytes int64, dur time.Duration) {
	if bytes <= 0 || dur <= 0 {
		return
	}
	kbps := float64(bytes*8) / dur.Seconds() / 1000
	pm.bwMu.Lock()
	defer pm.bwMu.Unlock()
	if pm.bwKbps == 0 {
		pm.bwKbps = kbps
	} else {
		// 70/30 smoothing keeps the estimate stable but responsive.
		pm.bwKbps = pm.bwKbps*0.7 + kbps*0.3
	}
	pm.bwSamples++
	pm.bwLast = time.Now()
}

// NetworkInfo reports the measured throughput and the quality tier it can
// carry. Low bandwidth -> the player stays on a lower rung (480p/720p),
// high bandwidth -> full quality (1080p/2K/4K) is unlocked.
func (pm *ProxyManager) NetworkInfo() map[string]interface{} {
	pm.bwMu.Lock()
	kbps := pm.bwKbps
	samples := pm.bwSamples
	last := pm.bwLast
	pm.bwMu.Unlock()

	quality := qualityForBandwidth(kbps)
	if kbps == 0 {
		// Nothing measured yet: assume a normal broadband line.
		quality = "1080p"
	}
	return map[string]interface{}{
		"kbps":     int(kbps),
		"samples":  samples,
		"quality":  quality,
		"maxLevel": maxLevelForQuality(quality),
		"measured": !last.IsZero(),
		"time":     time.Now().UnixMilli(),
	}
}

// qualityForBandwidth maps the measured throughput to a quality cap.
func qualityForBandwidth(kbps float64) string {
	switch {
	case kbps >= 22000:
		return "2160p"
	case kbps >= 12000:
		return "1440p"
	case kbps >= 6000:
		return "1080p"
	case kbps >= 2500:
		return "720p"
	case kbps >= 1200:
		return "480p"
	case kbps > 0:
		return "360p"
	default:
		return "1080p"
	}
}

// maxLevelForQuality returns the height the player may use at most.
func maxLevelForQuality(quality string) int {
	switch quality {
	case "2160p":
		return 2160
	case "1440p":
		return 1440
	case "1080p":
		return 1080
	case "720p":
		return 720
	case "480p":
		return 480
	case "360p":
		return 360
	default:
		return 1080
	}
}

// peekedBody replays the bytes that were buffered while probing the body
// and still closes the original response body.
type peekedBody struct {
	io.Reader
	closer io.Closer
}

func (p *peekedBody) Close() error { return p.closer.Close() }

// fetchWithDualRace retrieves the target URL with dual-engine (direct +
// tunnel) racing. The winner is the route that actually delivers BODY BYTES,
// not the one that answers with headers first - a route can return headers
// instantly and then stall forever, which is exactly what makes a stream
// take 15 seconds.
func (pm *ProxyManager) fetchWithDualRace(ctx context.Context, method, targetURL, referer, ua string, reqHeaders http.Header) (*http.Response, error) {
	type fetchRes struct {
		resp *http.Response
		err  error
		from string
	}

	resultChan := make(chan fetchRes, 4)

	doAttempt := func(aCtx context.Context, client *http.Client, label string) {
		upReq, err := http.NewRequestWithContext(aCtx, method, targetURL, nil)
		if err != nil {
			resultChan <- fetchRes{nil, err, label}
			return
		}
		pm.synthesizeHeaders(upReq, targetURL, referer, ua)
		if rangeHdr := reqHeaders.Get("Range"); rangeHdr != "" {
			upReq.Header.Set("Range", rangeHdr)
		}
		resp, err := client.Do(upReq)
		if err != nil {
			resultChan <- fetchRes{nil, err, label}
			return
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 400 {
			resultChan <- fetchRes{resp, nil, label}
			return
		}

		// Wait for the first body byte - this is the real speed test.
		br := bufio.NewReader(resp.Body)
		peekCh := make(chan error, 1)
		go func() {
			_, perr := br.Peek(1)
			peekCh <- perr
		}()
		select {
		case perr := <-peekCh:
			if perr != nil {
				resp.Body.Close()
				resultChan <- fetchRes{nil, perr, label}
				return
			}
		case <-time.After(firstByteTimeout):
			// This route answers with headers but never delivers data.
			resp.Body.Close()
			resultChan <- fetchRes{nil, fmt.Errorf("%s: no body data within %s", label, firstByteTimeout), label}
			return
		}

		resp.Body = &peekedBody{Reader: br, closer: resp.Body}
		resultChan <- fetchRes{resp, nil, label}
	}

	ctx1, cancel1 := context.WithCancel(ctx)
	ctx2, cancel2 := context.WithCancel(ctx)

	// Both routes start together; the first one that delivers real data wins.
	go doAttempt(ctx1, pm.directClient, "direct")
	go doAttempt(ctx2, pm.tunnelClient, "tunnel")

	var lastErr error
	var firstNon200 *http.Response

	for i := 0; i < 2; i++ {
		select {
		case res := <-resultChan:
			if res.err == nil && res.resp != nil {
				if res.resp.StatusCode >= 200 && res.resp.StatusCode < 400 {
					// Crucial: cancel only the loser; do NOT cancel the winner's context while streaming body!
					if res.from == "direct" {
						cancel2()
					} else {
						cancel1()
					}
					return res.resp, nil
				}
				if firstNon200 == nil {
					firstNon200 = res.resp
				} else {
					res.resp.Body.Close()
				}
			} else if res.err != nil {
				lastErr = res.err
			}
		case <-ctx.Done():
			cancel1()
			cancel2()
			if firstNon200 != nil {
				return firstNon200, nil
			}
			return nil, ctx.Err()
		}
	}

	cancel1()
	cancel2()
	if firstNon200 != nil {
		return firstNon200, nil
	}
	return nil, lastErr
}

// Prefetch warms an HLS manifest and its initial segments into memory for sub-millisecond start.
// manifestTTLs returns the fresh lifetime and the stale-while-revalidate
// lifetime of a playlist. Live playlists rotate every few seconds, so the
// warm copy is served instantly and refreshed in the background.
func manifestTTLs(body []byte) (time.Duration, time.Duration) {
	if bytes.Contains(body, []byte("#EXT-X-STREAM-INF")) {
		// Master playlists: the child variant URLs can be signed and expire,
		// so the copy must stay young.
		return 60 * time.Second, 3 * time.Minute
	}
	if bytes.Contains(body, []byte("#EXT-X-ENDLIST")) {
		return 2 * time.Hour, 2 * time.Hour
	}
	return 2 * time.Second, 15 * time.Second
}

// raceCandidateTimeout bounds how long one candidate source may take to
// hand over a usable manifest during a race. It is deliberately short: the
// user is waiting on this, and a source that needs longer is not the fastest
// one anyway.
const raceCandidateTimeout = 2500 * time.Millisecond

// RaceStreams tries several sources of the same channel in parallel and
// returns the index of the first one that answers. A dead or slow CDN can no
// longer delay the picture - the fastest source wins instead.
func (pm *ProxyManager) RaceStreams(streams []Stream, cid string, limit int) (int, bool, int) {
	if len(streams) == 0 {
		return -1, false, 0
	}
	if limit <= 0 || limit > len(streams) {
		limit = len(streams)
	}

	type result struct {
		idx int
		ok  bool
		ms  int
	}

	results := make(chan result, limit)
	sem := make(chan struct{}, limit)

	for i := 0; i < limit; i++ {
		go func(idx int, st Stream) {
			sem <- struct{}{}
			defer func() { <-sem }()

			t0 := time.Now()
			ok := pm.warmManifestFast(st.URL, st.Referer, st.UA, cid, raceCandidateTimeout)
			results <- result{idx: idx, ok: ok, ms: int(time.Since(t0).Milliseconds())}
		}(i, streams[i])
	}

	best := result{idx: -1}
	for i := 0; i < limit; i++ {
		r := <-results
		if r.ok {
			// The first success wins the race.
			return r.idx, true, r.ms
		}
		if best.idx == -1 {
			best = r
		}
	}
	return -1, false, best.ms
}

// warmManifest fetches a manifest, rewrites it and stores it in the RAM
// cache. It is the shared building block of the pre-warmer and the racer.
func (pm *ProxyManager) warmManifest(targetURL, referer, ua, cid string, timeout time.Duration) bool {
	return pm.warmManifestLane(targetURL, referer, ua, cid, timeout, false, true)
}

// warmManifestFast is the user initiated lane (hover / focus): it jumps the
// queue of the background warm-ups.
func (pm *ProxyManager) warmManifestFast(targetURL, referer, ua, cid string, timeout time.Duration) bool {
	return pm.warmManifestLane(targetURL, referer, ua, cid, timeout, true, true)
}

// PrefetchLight warms only the manifest (cheap). The standby pre-warmer uses
// it so the bandwidth stays free for the segments the user is about to watch.
func (pm *ProxyManager) PrefetchLight(targetURL, referer, ua, cid string) (bool, int) {
	t0 := time.Now()
	ok := pm.warmManifestLane(targetURL, referer, ua, cid, 7000*time.Millisecond, false, false)
	return ok, int(time.Since(t0).Milliseconds())
}

func (pm *ProxyManager) warmManifestLane(targetURL, referer, ua, cid string, timeout time.Duration, fast bool, withSegments bool) bool {
	if targetURL == "" {
		return false
	}
	cacheKey := fmt.Sprintf("%s|%s|%s", targetURL, referer, ua)

	// Already warm? Nothing to do.
	if val, ok := pm.manifestCache.Load(cacheKey); ok {
		if cm, ok := val.(*cachedManifest); ok && time.Now().Before(cm.staleUntil) {
			return true
		}
	}

	if timeout <= 0 {
		timeout = 7000 * time.Millisecond
	}

	// Warm-ups are throttled: the live stream the user is watching must
	// always keep the full bandwidth.
	sem := pm.warmSem
	wait := 1200 * time.Millisecond
	if fast {
		sem = pm.warmFastSem
		wait = 400 * time.Millisecond
	}
	if sem != nil {
		select {
		case sem <- struct{}{}:
			defer func() { <-sem }()
		case <-time.After(wait):
			// Could not get a slot in time - skip this warm-up round.
			return false
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	resp, err := pm.fetchWithDualRace(ctx, "GET", targetURL, referer, ua, http.Header{})
	if err != nil || resp == nil || resp.StatusCode < 200 || resp.StatusCode >= 400 {
		if resp != nil {
			resp.Body.Close()
		}
		return false
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	trimmedBytes := bytes.TrimPrefix(bodyBytes, []byte("\xef\xbb\xbf"))
	trimmedBytes = bytes.TrimSpace(trimmedBytes)

	if err != nil || (!bytes.Contains(trimmedBytes, []byte("#EXTM3U")) && !bytes.Contains(trimmedBytes, []byte("#EXT-X-"))) {
		return false
	}

	rewritten := pm.RewriteHLSPlaylist(string(trimmedBytes), targetURL, referer, ua, cid)
	pruned, variantsOK := pm.pruneMasterVariants(rewritten, referer, ua)
	if !variantsOK {
		// Every variant of this master playlist is dead -> the source itself
		// is dead. The race then moves on to the next source immediately.
		return false
	}
	rewritten = pruned
	rewrittenBytes := []byte(rewritten)

	freshTTL, staleTTL := manifestTTLs(trimmedBytes)
	pm.manifestCache.Store(cacheKey, &cachedManifest{
		content:    rewrittenBytes,
		expires:    time.Now().Add(freshTTL),
		staleUntil: time.Now().Add(staleTTL),
	})

	// Pull the child variant / first segments into RAM while we are here.
	lines := strings.Split(rewritten, "\n")
	if bytes.Contains(trimmedBytes, []byte("#EXT-X-STREAM-INF")) {
		for _, l := range lines {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "/api/proxy?") {
				if parsed, err := url.Parse(l); err == nil {
					subTarget := decodeParam(parsed.Query().Get("u"))
					subRef := decodeParam(parsed.Query().Get("r"))
					subUA := decodeParam(parsed.Query().Get("a"))
					if subTarget != "" && subTarget != targetURL {
						if withSegments {
							go pm.Prefetch(subTarget, subRef, subUA, cid)
						} else {
							go pm.PrefetchLight(subTarget, subRef, subUA, cid)
						}
					}
				}
				break
			}
		}
	} else if withSegments && bytes.Contains(trimmedBytes, []byte("#EXTINF")) {
		segCount := 0
		for _, l := range lines {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "/api/proxy?") {
				if parsed, err := url.Parse(l); err == nil {
					subTarget := decodeParam(parsed.Query().Get("u"))
					subRef := decodeParam(parsed.Query().Get("r"))
					subUA := decodeParam(parsed.Query().Get("a"))
					if subTarget != "" && subTarget != targetURL {
						go pm.PrefetchSegment(subTarget, subRef, subUA)
						segCount++
						if segCount >= 2 {
							break
						}
					}
				}
			}
		}
	}

	if cid != "" && pm.health != nil {
		pm.health.Set(cid, "online", 0, "race", 0)
	}
	return true
}

// Prefetch downloads the manifest into RAM so a click is served instantly.
func (pm *ProxyManager) Prefetch(targetURL, referer, ua, cid string) (bool, int) {
	t0 := time.Now()
	ok := pm.warmManifest(targetURL, referer, ua, cid, 7000*time.Millisecond)
	return ok, int(time.Since(t0).Milliseconds())
}

// PrefetchFast is the user initiated lane (hover / focus / click).
func (pm *ProxyManager) PrefetchFast(targetURL, referer, ua, cid string) (bool, int) {
	t0 := time.Now()
	ok := pm.warmManifestFast(targetURL, referer, ua, cid, 7000*time.Millisecond)
	return ok, int(time.Since(t0).Milliseconds())
}

// PrefetchSegment downloads the media segment into RAM cache so playback starts with 0ms buffering.
func (pm *ProxyManager) PrefetchSegment(targetURL, referer, ua string) {
	if targetURL == "" {
		return
	}
	cacheKey := fmt.Sprintf("%s|%s|%s", targetURL, referer, ua)
	if val, ok := pm.segmentCache.Load(cacheKey); ok {
		if cs, ok := val.(*cachedSegment); ok && time.Now().Before(cs.expires) {
			return // Already cached and fresh
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Segment downloads are throttled as well: a burst of warm-ups must not
	// eat the bandwidth the live stream needs.
	if pm.warmSem != nil {
		select {
		case pm.warmSem <- struct{}{}:
			defer func() { <-pm.warmSem }()
		case <-time.After(900 * time.Millisecond):
			return
		}
	}

	resp, err := pm.fetchWithDualRace(ctx, "GET", targetURL, referer, ua, http.Header{})
	if err != nil || resp == nil || resp.StatusCode < 200 || resp.StatusCode >= 400 {
		if resp != nil {
			resp.Body.Close()
		}
		return
	}
	defer resp.Body.Close()

	// Read segment up to 8MB
	segStart := time.Now()
	segBytes, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil || len(segBytes) < 256 {
		return
	}
	// The real CDN throughput of a media segment is the best estimate of
	// what the line can carry -> drives the auto quality.
	pm.sampleBandwidth(int64(len(segBytes)), time.Since(segStart))

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		lower := strings.ToLower(targetURL)
		if strings.Contains(lower, ".ts") {
			contentType = "video/mp2t"
		} else if strings.Contains(lower, ".m4s") || strings.Contains(lower, ".mp4") {
			contentType = "video/mp4"
		} else if strings.Contains(lower, ".aac") {
			contentType = "audio/aac"
		} else {
			contentType = "video/mp2t"
		}
	}

	pm.segmentCache.Store(cacheKey, &cachedSegment{
		content:     segBytes,
		contentType: contentType,
		expires:     time.Now().Add(60 * time.Second),
	})
}

// ProxyLogo serves channel logos with on-disk caching for instant rendering.
func (pm *ProxyManager) ProxyLogo(w http.ResponseWriter, r *http.Request) {
	targetURL := decodeParam(r.URL.Query().Get("u"))
	if targetURL == "" {
		http.Error(w, `{"error":"missing ?u="}`, http.StatusBadRequest)
		return
	}

	hasher := sha1.New()
	hasher.Write([]byte(targetURL))
	hashKey := hex.EncodeToString(hasher.Sum(nil))

	imgPath := filepath.Join(pm.logosDir, hashKey+".img")
	typePath := filepath.Join(pm.logosDir, hashKey+".type")

	// Disk cache hit -> serve instantly
	if data, err := os.ReadFile(imgPath); err == nil {
		cType := "image/png"
		if tData, err := os.ReadFile(typePath); err == nil {
			cType = string(tData)
		}
		w.Header().Set("Content-Type", cType)
		w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}

	// Fetch from upstream. The direct client is locked to HTTP/1.1 for the
	// media paths, but several CDNs (google, brave) only answer on HTTP/2, so
	// fall back to the browser client when the direct attempt fails.
	fetchLogo := func(client *http.Client, rawURL string) ([]byte, string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()

		upReq, err := http.NewRequestWithContext(ctx, "GET", rawURL, nil)
		if err != nil {
			return nil, "", err
		}
		upReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		upReq.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
		upReq.Header.Set("Accept-Language", "en-US,en;q=0.9")

		resp, err := client.Do(upReq)
		if err != nil {
			return nil, "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, "", fmt.Errorf("status %d", resp.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
		if err != nil {
			return nil, "", err
		}
		if len(body) == 0 {
			return nil, "", fmt.Errorf("empty body")
		}
		// Some hosts answer /favicon.ico with an HTML error page (200 OK). That
		// would render as a broken image, so reject markup and let the caller
		// fall back to the icon service instead.
		if trimmed := bytes.TrimLeft(body, " \t\r\n"); len(trimmed) > 0 && trimmed[0] == '<' {
			return nil, "", fmt.Errorf("not an image (markup)")
		}
		ct := resp.Header.Get("Content-Type")
		if ct == "" {
			ct = "image/png"
		}
		return body, ct, nil
	}

	data, cType, err := fetchLogo(pm.directClient, targetURL)
	if err != nil || len(data) == 0 {
		if bData, bType, bErr := fetchLogo(browserClient, targetURL); bErr == nil && len(bData) > 0 {
			data, cType = bData, bType
			err = nil
		}
	}
	// Fallback 1: Google Favicon service (high-resolution 128px PNG)
	if err != nil || len(data) == 0 {
		if gfb := googleFaviconURL(targetURL); gfb != "" {
			if fData, fType, fErr := fetchLogo(pm.directClient, gfb); fErr == nil && len(fData) > 0 {
				data, cType = fData, fType
				err = nil
			} else if fData2, fType2, fErr2 := fetchLogo(browserClient, gfb); fErr2 == nil && len(fData2) > 0 {
				data, cType = fData2, fType2
				err = nil
			}
		}
	}
	// Fallback 2: DuckDuckGo icon service, which has a real icon for almost every
	// domain. This is what makes the speed-dial / engine logos always render.
	if err != nil || len(data) == 0 {
		if fb := ddgFaviconURL(targetURL); fb != "" {
			if fData, fType, fErr := fetchLogo(pm.directClient, fb); fErr == nil && len(fData) > 0 {
				data, cType = fData, fType
				err = nil
			} else if fData2, fType2, fErr2 := fetchLogo(browserClient, fb); fErr2 == nil && len(fData2) > 0 {
				data, cType = fData2, fType2
				err = nil
			}
		}
	}
	if err != nil || len(data) == 0 {
		http.Error(w, "logo fetch failed", http.StatusBadGateway)
		return
	}

	// Save to disk asynchronously
	go func() {
		_ = os.WriteFile(imgPath, data, 0644)
		_ = os.WriteFile(typePath, []byte(cType), 0644)
	}()

	w.Header().Set("Content-Type", cType)
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// googleFaviconURL queries Google's favicon service for a 128px high-resolution icon.
func googleFaviconURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	host := u.Hostname()
	if strings.Contains(host, "google.") {
		return ""
	}
	return "https://www.google.com/s2/favicons?domain=" + url.QueryEscape(host) + "&sz=128"
}

// ddgFaviconURL builds a reliable fallback icon URL for a host. Many sites do
// not serve /favicon.ico at the root, and the DuckDuckGo icon service returns a
// real icon for almost every domain.
func ddgFaviconURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	host := u.Hostname()
	if strings.Contains(host, "icons.duckduckgo.com") {
		return "" // avoid a pointless loop
	}
	return "https://icons.duckduckgo.com/ip3/" + host + ".ico"
}
