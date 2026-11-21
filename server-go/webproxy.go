package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"html"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type CachedAsset struct {
	contentType string
	statusCode  int
	body        []byte
	expiresAt   time.Time
}

var (
	proxyAssetCache   = make(map[string]CachedAsset)
	proxyAssetCacheMu sync.RWMutex
)

func getCachedAsset(u string) (CachedAsset, bool) {
	proxyAssetCacheMu.RLock()
	defer proxyAssetCacheMu.RUnlock()
	c, ok := proxyAssetCache[u]
	if ok && time.Now().Before(c.expiresAt) {
		return c, true
	}
	return CachedAsset{}, false
}

func setCachedAsset(u string, contentType string, status int, body []byte, ttl time.Duration) {
	if len(body) == 0 || len(body) > 3*1024*1024 { // cache up to 3MB per asset
		return
	}
	proxyAssetCacheMu.Lock()
	defer proxyAssetCacheMu.Unlock()
	if len(proxyAssetCache) > 2000 {
		proxyAssetCache = make(map[string]CachedAsset) // reset when full
	}
	proxyAssetCache[u] = CachedAsset{
		contentType: contentType,
		statusCode:  status,
		body:        body,
		expiresAt:   time.Now().Add(ttl),
	}
}

var (
	headRegex     = regexp.MustCompile(`(?i)<head[^>]*>`)
	metaCSPRegex  = regexp.MustCompile(`(?i)<meta[^>]*http-equiv=["']?(?:content-security-policy|x-frame-options)["']?[^>]*>`)
	metaXFRegex   = regexp.MustCompile(`(?i)<meta[^>]*name=["']?(?:content-security-policy|x-frame-options)["']?[^>]*>`)

	// Dedicated high-performance browser web client with direct internet connection (bypassing dead 8080 proxy)
	browserTransport = &http.Transport{
		Proxy: nil, // DIRECT INTERNET: never route through local 8080 proxy
		DialContext: (&net.Dialer{
			Timeout:   8 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   30,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 18 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    false,
	}

	browserJar, _ = cookiejar.New(nil)

	browserClient = &http.Client{
		Transport: browserTransport,
		Jar:       browserJar,
		Timeout:   25 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 12 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	tunnelURL, _ = url.Parse("http://127.0.0.1:8080")

	browserTunnelTransport = &http.Transport{
		Proxy: http.ProxyURL(tunnelURL),
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    false,
	}

	browserTunnelClient = &http.Client{
		Transport: browserTunnelTransport,
		Jar:       browserJar,
		Timeout:   25 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 12 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
)


// ProxyWeb serves web pages for the in-app Chromium Browser,
// stripping frame-busting headers (X-Frame-Options, CSP) and injecting <base href>
func (pm *ProxyManager) ProxyWeb(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rawURL := q.Get("u")
	if rawURL == "" {
		writeBrowserError(w, "No address to open", "The browser did not receive a destination URL.", "")
		return
	}

	targetURL := decodeParam(rawURL)
	if targetURL == "" {
		targetURL = rawURL
	}

	targetURL = strings.TrimSpace(targetURL)
	if strings.HasPrefix(targetURL, "//") {
		targetURL = "https:" + targetURL
	}
	targetURL = UnwrapRedirect(targetURL)
	targetURL = strings.TrimSpace(targetURL)
	if strings.HasPrefix(targetURL, "//") {
		targetURL = "https:" + targetURL
	}

	// Clean up any double or triple leading slashes in scheme: https:/// -> https://
	if m := regexp.MustCompile(`^(https?:)/+`).FindStringSubmatch(targetURL); len(m) > 1 {
		targetURL = m[1] + "//" + strings.TrimPrefix(targetURL, m[0])
	}

	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		if strings.Contains(targetURL, ".") && !strings.Contains(targetURL, " ") && !strings.HasPrefix(targetURL, "/") {
			targetURL = "https://" + targetURL
		} else {
			// A bare phrase is a Google search. The browser normally builds this
			// URL itself; this branch only covers a hand-typed query that
			// reached the proxy without going through the omnibox.
			targetURL = googleSearchURL(targetURL)
		}
	}

	// 2. Google results pages must be requested in Google's own embeddable
	// mode (igu=1). Without it Google answers with X-Frame-Options:
	// SAMEORIGIN and refuses to render inside a frame at all.
	if strings.Contains(targetURL, "google.") && strings.Contains(targetURL, "/search") {
		if !strings.Contains(targetURL, "igu=1") {
			if strings.Contains(targetURL, "?") {
				targetURL += "&igu=1"
			} else {
				targetURL += "?igu=1"
			}
		}
	}

	// 3. A YouTube video is opened in its embeddable form — the only form
	// YouTube allows inside a frame.
	if IsYouTubeHost(targetURL) {
		if emb := YouTubeEmbedURL(targetURL); emb != "" {
			http.Redirect(w, r, emb, http.StatusTemporaryRedirect)
			return
		}
	}

	// 4. Check RAM asset cache for static sub-requests (CSS, JS, images, fonts)
	if cached, ok := getCachedAsset(targetURL); ok {
		w.Header().Set("Content-Type", cached.contentType)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("X-Vyora-Cache", "HIT")
		w.WriteHeader(cached.statusCode)
		_, _ = w.Write(cached.body)
		return
	}

	parsed, err := url.Parse(targetURL)
	if err != nil {
		writeBrowserError(w, "Invalid address", "That address could not be parsed.", targetURL)
		return
	}

	// A real document navigation carries an HTML Accept / Sec-Fetch-Dest=document.
	// Anything else is an in-page API call (fetch/XHR) that the injected same-origin
	// bridge routed here. Sub-requests must never receive the branded error page or
	// the HTML injector — the page expects the raw payload (JSON, etc).
	isDocRequest := r.Header.Get("Sec-Fetch-Dest") == "document" ||
		strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html")

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	// Forward the request body for writes (SPA API POST/PUT) so JSON APIs work.
	var reqBody []byte
	if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
		reqBody, _ = io.ReadAll(io.LimitReader(r.Body, 4*1024*1024))
	}

	upReq, err := http.NewRequestWithContext(ctx, r.Method, targetURL, bytes.NewReader(reqBody))
	if err != nil {
		writeBrowserError(w, "Could not build the request", err.Error(), targetURL)
		return
	}
	// Allow the body to be replayed: the fallback client below re-sends the same
	// request, and a consumed reader would silently send an empty payload (which
	// upstream rejects with 400 instead of the real answer).
	upReq.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(reqBody)), nil
	}

	// Modern Chrome Desktop headers
	upReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	upReq.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
	upReq.Header.Set("Accept-Language", "en-US,en;q=0.9,ur;q=0.8")
	upReq.Header.Set("Sec-Ch-Ua", `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`)
	upReq.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	upReq.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
	upReq.Header.Set("Sec-Fetch-Dest", "document")
	upReq.Header.Set("Sec-Fetch-Mode", "navigate")
	upReq.Header.Set("Sec-Fetch-Site", "none")
	upReq.Header.Set("Sec-Fetch-User", "?1")
	upReq.Header.Set("Upgrade-Insecure-Requests", "1")
	upReq.Header.Set("Referer", fmt.Sprintf("%s://%s/", parsed.Scheme, parsed.Host))

	// For in-page API calls forward the headers the page actually sent, so JSON
	// endpoints (fetch/XHR) keep their content negotiation and payload encoding.
	// YouTube's InnerTube API, for instance, identifies its client through
	// X-YouTube-Client-Name / X-YouTube-Client-Version and gzips its body with a
	// Content-Encoding: gzip request header. The old whitelist dropped both, so
	// the gzipped body reached YouTube without its encoding — YouTube answered
	// 400 and the embed player never received a playable response.
	if !isDocRequest {
		for k, vv := range r.Header {
			switch strings.ToLower(k) {
			case "host", "connection", "content-length", "accept-encoding",
				"keep-alive", "proxy-connection", "transfer-encoding", "upgrade",
				"te", "trailer", "cookie", "origin", "referer", "accept",
				"user-agent", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user":
				continue
			}
			for _, v := range vv {
				upReq.Header.Add(k, v)
			}
		}
		if v := r.Header.Get("Accept"); v != "" {
			upReq.Header.Set("Accept", v)
		}
		upReq.Header.Set("Origin", fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host))
		upReq.Header.Set("Sec-Fetch-Dest", "empty")
		upReq.Header.Set("Sec-Fetch-Mode", "cors")
		upReq.Header.Set("Sec-Fetch-Site", "same-origin")
	}

	resp, doErr := browserClient.Do(upReq)
	if doErr != nil || (resp != nil && (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusForbidden || resp.StatusCode >= 500)) {
		// Try tunnel client fallback
		log.Printf("[WEBPROXY] Primary fetch (status=%v, err=%v) for %s. Retrying via tunnel proxy...",
			func() int {
				if resp != nil {
					return resp.StatusCode
				}
				return 0
			}(), doErr, targetURL)
		upReqTunnel, tErr := http.NewRequestWithContext(ctx, r.Method, targetURL, bytes.NewReader(reqBody))
		if tErr == nil {
			upReqTunnel.Header = upReq.Header.Clone()
			tResp, tErr := browserTunnelClient.Do(upReqTunnel)
			if tErr == nil && tResp != nil {
				if resp != nil && resp.Body != nil {
					_ = resp.Body.Close()
				}
				resp = tResp
				doErr = nil
				log.Printf("[WEBPROXY] Tunnel succeeded for %s with status %d", targetURL, tResp.StatusCode)
			}
		}
	}

	if doErr != nil && pm.directClient != nil {
		log.Printf("[WEBPROXY] Primary client failed for %s: %v. Retrying directClient...", targetURL, doErr)
		upReqDirect, dErr := http.NewRequestWithContext(ctx, r.Method, targetURL, bytes.NewReader(reqBody))
		if dErr == nil {
			upReqDirect.Header = upReq.Header.Clone()
			resp, doErr = pm.directClient.Do(upReqDirect)
		}
	}

	// NO SILENT SEARCH-ENGINE FALLBACK.
	//
	// The old code answered a blocked/failed search engine with DuckDuckGo's
	// HTML while keeping the original engine's name in the URL. The user then
	// picked Google and saw DuckDuckGo, with no indication that a swap had
	// happened — the single biggest complaint about this browser.
	//
	// A failure is now reported as a failure. The browser shows an honest
	// error page (or, for Google, the browser engine renders the real page
	// directly and this proxy is never involved).

	if doErr != nil {
		log.Printf("[WEBPROXY] Failed to fetch %s: %v", targetURL, doErr)
		writeBrowserError(w, "This site could not be reached", "The server did not respond in time. It may be offline, geo-blocked, or blocking the proxy. Try a different site or search.", targetURL)
		return
	}

	// Sites behind bot protection (Cloudflare, Akamai...) sometimes answer with 401/403/429
	// or a 5xx challenge, but still return HTML pages (such as Cloudflare Turnstile, readable article text, or CAPTCHA).
	// If the response contains HTML, do NOT discard it! Allow it to be decoded and injected with base href & frame busters.
	if isDocRequest && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden ||
		resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500) {
		cType := strings.ToLower(resp.Header.Get("Content-Type"))
		if !strings.Contains(cType, "text/html") && !strings.Contains(cType, "application/xhtml") {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 8192))
			resp.Body.Close()
			log.Printf("[WEBPROXY] Blocked by %s with non-HTML status %d (%s)", parsed.Host, resp.StatusCode, cType)
			writeBrowserError(w, "This site blocked the request",
				fmt.Sprintf("%s answered with HTTP %d — it actively shields itself from automated access, so it cannot be shown inside the app. Search for this topic instead, or open another source.", parsed.Host, resp.StatusCode), targetURL)
			return
		}
		log.Printf("[WEBPROXY] Upstream %s returned status %d with HTML (%s) - unblocking via frame-buster", parsed.Host, resp.StatusCode, cType)
	}
	defer resp.Body.Close()

	// Update targetURL if redirected
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL := resp.Request.URL.String()
		if finalURL != "" {
			targetURL = finalURL
		}
	}

	// A redirect that lands on a YouTube video is redirected directly to its embed form;
	// other YouTube pages fall through and are served as the real page.
	if isDocRequest && IsYouTubeHost(targetURL) && !strings.Contains(targetURL, "/embed") {
		if embedURL := YouTubeEmbedURL(targetURL); embedURL != "" {
			http.Redirect(w, r, embedURL, http.StatusTemporaryRedirect)
			return
		}
	}

	// NO "no organic results" DETECTION ANYMORE.
	//
	// The old code counted result markers in the returned HTML and, when it
	// found none, redirected the browser to DuckDuckGo while keeping the
	// original engine in the URL. With Google that check ALWAYS fired (Google
	// answers a plain HTTP client with a JavaScript-only shell that has no
	// result markup), so Google silently became DuckDuckGo.
	//
	// Search pages are now rendered by the browser engine itself, so this
	// proxy never has to judge whether a page "has results".

	contentType := resp.Header.Get("Content-Type")
	isHTML := strings.Contains(strings.ToLower(contentType), "text/html")

	// Strip frame-busting and connection-metadata headers so the webview renders.
	// Alt-Svc is the critical one: an upstream advertises its alternative service
	// for the *origin*, so forwarding "h3=\":443\"" made Chrome believe localhost
	// spoke HTTP/3 on port 443 and try that connection for later same-origin calls.
	// The TLS/ALPN upgrade then failed and every such request died with
	// ERR_ALPN_NEGOTIATION_FAILED / ERR_CONNECTION_CLOSED — which is exactly why
	// YouTube's youtubei/v1/player never answered and the video never attached.
	for k, vv := range resp.Header {
		lk := strings.ToLower(k)
		switch lk {
		case "x-frame-options", "frame-options",
			"content-security-policy", "content-security-policy-report-only",
			"strict-transport-security", "alt-svc", "public-key-pins", "expect-ct",
			"nel", "report-to", "server", "clear-site-data":
			continue
		}
		if isHTML && (lk == "content-encoding" || lk == "content-length") {
			// Strip encoding/length for modified HTML so browser decodes as plain text
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("X-Frame-Options", "ALLOWALL")

	if isHTML {
		var reader io.Reader = resp.Body
		ce := strings.ToLower(resp.Header.Get("Content-Encoding"))
		if ce == "gzip" {
			gz, gzErr := gzip.NewReader(resp.Body)
			if gzErr == nil {
				defer gz.Close()
				reader = gz
			}
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(reader, 15*1024*1024))
		if err != nil && len(bodyBytes) == 0 {
			log.Printf("[WEBPROXY] Failed to read HTML for %s: %v", targetURL, err)
			writeBrowserError(w, "Page could not be loaded", "The page content was interrupted while downloading.", targetURL)
			return
		}

		htmlStr := string(bodyBytes)

		// Strip in-HTML <meta> CSP / X-Frame-Options tags
		htmlStr = metaCSPRegex.ReplaceAllString(htmlStr, "")
		htmlStr = metaXFRegex.ReplaceAllString(htmlStr, "")

		baseTag := fmt.Sprintf(`<base href="%s">`, html.EscapeString(targetURL))
		injectScript := fmt.Sprintf(`<script>
		(function() {
			// Capture the REAL host window BEFORE the frame-buster override below.
			// Once window.parent is redefined it equals window.self, so anything
			// posted through window.parent lands back inside this page and the host
			// app never hears about clicks/searches ("nothing happens" bug).
			var realParent = null;
			try { realParent = window.parent; } catch (e) { realParent = null; }
			function sendToHost(msg) {
				try {
					if (realParent && realParent !== window) {
						realParent.postMessage(msg, '*');
						return true;
					}
				} catch (e) {}
				return false;
			}
			function unpackRedirect(u) {
				if (!u) return u;
				try {
					var fixed = u.replace(/&amp;/g, '&');
					if (fixed.indexOf('//') === 0) fixed = 'https:' + fixed;

					// 1. DuckDuckGo: duckduckgo.com/l/?uddg=<dest> or /l/?uddg=
					if (fixed.indexOf('/l/?') >= 0 && fixed.indexOf('uddg=') >= 0) {
						var parsed = new URL(fixed, 'https://duckduckgo.com');
						var dest = parsed.searchParams.get('uddg');
						if (dest) return unpackRedirect(dest);
					}
					// 2. Google: /url?q=<dest> or /url?url=<dest>
					if (fixed.indexOf('/url?') >= 0 && (fixed.indexOf('q=') >= 0 || fixed.indexOf('url=') >= 0)) {
						var parsed = new URL(fixed, 'https://www.google.com');
						var dest = parsed.searchParams.get('q') || parsed.searchParams.get('url');
						if (dest) return unpackRedirect(dest);
					}
					// 3. Bing: /ck/a?...&u=a1<base64>
					if (fixed.indexOf('/ck/a') >= 0 && fixed.indexOf('u=') >= 0) {
						var parsed = new URL(fixed, 'https://www.bing.com');
						var uParam = parsed.searchParams.get('u');
						if (uParam && uParam.indexOf('a1') === 0) {
							var b64 = uParam.slice(2).replace(/-/g, '+').replace(/_/g, '/');
							while (b64.length %% 4 !== 0) b64 += '=';
							try {
								var decoded = atob(b64);
								if (decoded) {
									if (decoded.indexOf('http://') === 0 || decoded.indexOf('https://') === 0) {
										return unpackRedirect(decoded);
									}
									if (decoded.indexOf('/') === 0) {
										return unpackRedirect('https://www.bing.com' + decoded);
									}
								}
							} catch (e) {}
						}
					}
					// 4. Yahoo: /RU=<encoded>/...
					if (fixed.indexOf('/RU=') >= 0) {
						var m = fixed.match(/\/RU=([^/]+)/);
						if (m && m[1]) {
							var decoded = decodeURIComponent(m[1]);
							if (decoded && (decoded.indexOf('http://') === 0 || decoded.indexOf('https://') === 0)) {
								return unpackRedirect(decoded);
							}
						}
					}
				} catch (e) {}
				return u;
			}
			function proxyNav(url) {
				if (!url) return false;
				var cleanUrl = unpackRedirect(url);
				sendToHost({ type: 'VYORA_NAVIGATE', url: cleanUrl });
				if (cleanUrl.indexOf('youtube-nocookie.com/embed/') >= 0 || cleanUrl.indexOf('youtube.com/embed/') >= 0) {
					try {
						window.location.href = cleanUrl;
					} catch (e) {
						try { window.location.assign(cleanUrl); } catch (e2) {}
					}
					return true;
				}
				var proxied = window.location.origin + '/api/webproxy?u=' + encodeURIComponent(cleanUrl);
				try {
					window.location.href = proxied;
				} catch (e) {
					try { window.location.assign(proxied); } catch (e2) {}
				}
				return true;
			}

			try {
				// 1. Frame-Buster Neutralizer: makes the page believe it is the top window
				Object.defineProperty(window, 'top', { get: function() { return window.self; }, configurable: true });
				Object.defineProperty(window, 'parent', { get: function() { return window.self; }, configurable: true });
				Object.defineProperty(window, 'frameElement', { get: function() { return null; }, configurable: true });
			} catch(e) {}

			window.__VYORA_CURRENT_URL__ = %s;
			window.__VYORA_CHROMIUM__ = true;

			// 1b. History API guard. Because a <base href> pointing at the remote
			// site is injected, single-page apps (YouTube, etc.) call
			// history.replaceState/pushState with an ABSOLUTE remote URL. That throws
			// an uncaught SecurityError ("cannot be created in a document with origin
			// localhost") which aborts the whole SPA bootstrap and leaves a blank
			// page. Drop the URL (or keep a same-origin one) so the call never throws.
			// Wrapped on BOTH the history instance and History.prototype, because
			// frameworks sometimes reach for the prototype method directly.
			try {
				var vyoraWrapHistory = function(orig) {
					return function(state, title, url) {
						try {
							if (url != null && url !== '') {
								// The real security check is against document.baseURI (the
								// injected <base href> points at the REMOTE site), not
								// against __VYORA_CURRENT_URL__. A root-relative path such
								// as "/api/webproxy?u=..." therefore resolves to the remote
								// host and throws SecurityError. Only keep the URL when the
								// base-resolved form is genuinely same-origin — and pass the
								// FULLY ABSOLUTE href, never a bare pathname (a pathname would
								// be re-resolved against the remote <base> and throw).
								var resolved = null;
								try { resolved = new URL(String(url), document.baseURI || window.location.href); } catch (e) { resolved = null; }
								if (!resolved || resolved.origin !== window.location.origin) {
									url = null; // cross-origin -> would throw SecurityError
								} else {
									url = resolved.href; // absolute, same-origin -> safe
								}
							}
						} catch (e) { url = null; }
						try { return orig.call(window.history, state, title, url); } catch (e) { return undefined; }
					};
				};
				window.history.pushState = vyoraWrapHistory(window.history.pushState);
				window.history.replaceState = vyoraWrapHistory(window.history.replaceState);
				try {
					History.prototype.pushState = vyoraWrapHistory(History.prototype.pushState);
					History.prototype.replaceState = vyoraWrapHistory(History.prototype.replaceState);
				} catch (e) {}
			} catch(e) {}

			// Synchronize page title & URL with parent
			function syncState(manifest) {
				var iconLink = document.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]');
				var iconUrl = '';
				try { iconUrl = iconLink ? new URL(iconLink.getAttribute('href') || '', document.baseURI).href : ''; } catch (e) {}
				var themeMeta = document.querySelector('meta[name="theme-color"]');
				var appName = document.title || window.location.hostname;
				if (manifest && typeof manifest === 'object') {
					appName = manifest.name || manifest.short_name || appName;
					if (Array.isArray(manifest.icons) && manifest.icons.length) {
						var icons = manifest.icons.slice().sort(function(a, b) {
							var score = function(icon) { return /512/.test(icon.sizes || '') ? 3 : /192/.test(icon.sizes || '') ? 2 : 1; };
							return score(b) - score(a);
						});
						try { iconUrl = new URL(icons[0].src, manifest.__url || document.baseURI).href; } catch (e) {}
					}
				}
				sendToHost({
					type: 'VYORA_PAGE_SYNC',
					url: window.__VYORA_CURRENT_URL__,
					title: appName,
					icon: iconUrl,
					themeColor: themeMeta ? themeMeta.getAttribute('content') || '' : (manifest && manifest.theme_color) || ''
				});
			}
			function loadAppManifest() {
				var link = document.querySelector('link[rel="manifest"]');
				if (!link) return;
				var manifestUrl = '';
				try { manifestUrl = new URL(link.getAttribute('href') || '', document.baseURI).href; } catch (e) { return; }
				fetch(manifestUrl).then(function(response) { if (!response.ok) throw new Error('manifest unavailable'); return response.json(); }).then(function(manifest) {
					if (manifest && typeof manifest === 'object') { manifest.__url = manifestUrl; syncState(manifest); }
				}).catch(function() {});
			}
			if (document.readyState === 'complete') syncState();
			else window.addEventListener('load', syncState);

			// 2. Intercept clicks: keep navigation inside proxy, unpack redirects, and notify parent
			document.addEventListener('click', function(e) {
				var el = e.target;
				if (!el || !el.closest) return;
				var a = el.closest('a');
				if (!a) return;
				if (a.target === '_blank') a.target = '_self';
				var href = a.getAttribute('href') || '';
				if (!href || href === '#' || href.startsWith('javascript:')) return;
				
				var absUrl = a.href || href;
				if (!absUrl) return;

				// Always unpack search redirects (DDG, Google, Bing, Yahoo) first
				absUrl = unpackRedirect(absUrl);

				// YouTube: turn a single video link into its embed form (the only
				// form YouTube allows in a frame). Home / search / channel links are
				// left untouched so the real page loads instead of a dead
				// "listType=search" embed ("This video is unavailable 152 - 4").
				// The nocookie host is used because www.youtube.com/embed refuses to
				// initialise inside a non-YouTube embedder and answers 152 - 4.
				if (absUrl.indexOf('youtube.com') >= 0 || absUrl.indexOf('youtu.be') >= 0) {
					var ytId = '';
					var vMatch = absUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
					var sMatch = absUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
					var eMatch = absUrl.match(/youtube\.com\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
					if (vMatch) ytId = vMatch[1];
					else if (sMatch) ytId = sMatch[1];
					else if (eMatch) ytId = eMatch[1];
					if (ytId) {
						absUrl = 'https://www.youtube-nocookie.com/embed/' + ytId + '?autoplay=1&rel=0&playsinline=1';
					}
				}

				var lower = absUrl.toLowerCase();
				if (lower.endsWith('.apk') || lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.endsWith('.zip') || lower.endsWith('.avi') || lower.endsWith('.webm') || lower.endsWith('.ts')) {
					e.preventDefault();
					sendToHost({ type: 'VYORA_DOWNLOAD', url: absUrl, name: a.innerText || '' });
					return;
				}

				// Intercept normal navigation and notify parent to navigate via WebProxy!
				e.preventDefault();
				proxyNav(absUrl);
			}, true);

			// 3. Intercept form submits: keep search form submissions inside proxy
			document.addEventListener('submit', function(e) {
				var form = e.target;
				if (!form) return;
				var action = form.action || window.location.href;
				var method = (form.method || 'GET').toUpperCase();
				if (method === 'GET') {
					e.preventDefault();
					try {
						var formData = new FormData(form);
						// Strip I'm Feeling Lucky buttons so Google shows search results!
						formData.delete('btnI');
						formData.delete('btnK');
						if (action.indexOf('google.') >= 0 && !formData.has('igu')) {
							formData.set('igu', '1');
						}
						var params = new URLSearchParams(formData).toString();
						var sep = action.indexOf('?') >= 0 ? '&' : '?';
						var finalUrl = params ? (action + sep + params) : action;
						proxyNav(finalUrl);
					} catch(err) {
						form.submit();
					}
				}
			}, true);

			// 4. Intercept window.open
			window.open = function(url) {
				if (url) proxyNav(url);
				return window;
			};

			// 5. Same-origin API bridge. A rewriting proxy makes the page run on
			// localhost, so every fetch/XHR the page makes back to its OWN site
			// (YouTube's youtubei API, and every other JavaScript app) is now a
			// cross-origin request the browser blocks with CORS — that is why such
			// apps rendered an empty shell. Send those same-site calls back through
			// the proxy so they stay same-origin and actually receive their data.
			// Third-party origins (CDNs, ads, analytics) are left untouched.
			(function() {
				var siteOrigin = '';
				var siteHost = '';
				try { siteOrigin = new URL(window.__VYORA_CURRENT_URL__ || document.baseURI).origin; siteHost = new URL(siteOrigin).hostname; } catch (e) { siteOrigin = ''; siteHost = ''; }
				// www.youtube.com and youtube.com are different origins but the same
				// site; comparing registrable domains keeps the app's own API calls
				// (youtubei, /youtubei/v1/*) same-origin instead of CORS-blocked.
				function sameSite(host) {
					if (!host || !siteHost) return false;
					if (host === siteHost) return true;
					// youtube.com and youtube-nocookie.com are distinct registrable
					// domains but one site: the nocookie embed player calls its API on
					// www.youtube.com, so both must be treated as the page's own site.
					var yt = function(h) { return /(^|\.)youtube(-nocookie)?\.com$/.test(h) || /(^|\.)youtu\.be$/.test(h); };
					if (yt(host) && yt(siteHost)) return true;
					var a = host.split('.').slice(-2).join('.');
					var b = siteHost.split('.').slice(-2).join('.');
					return a === b;
				}
				function toProxy(u) {
					if (typeof u !== 'string' || !u) return null;
					if (u.indexOf('/api/webproxy') === 0) return null;
					if (u.indexOf('blob:') === 0 || u.indexOf('data:') === 0) return null;
					try {
						var abs = new URL(u, window.__VYORA_CURRENT_URL__ || document.baseURI);
						if (abs.origin === window.location.origin) return null;      // already proxied / local
						var isSite = siteOrigin && (abs.origin === siteOrigin || sameSite(abs.hostname));
						// YouTube/Google serve UI assets and the media probes from these
						// hosts; the app fetch()es them and would otherwise hit CORS.
						var isCdn = /(^|\.)(gstatic\.com|ytimg\.com|ggpht\.com|googleusercontent\.com|googlevideo\.com|google\.com|youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(abs.hostname);
						if (!isSite && !isCdn) return null;                          // third-party: leave alone
						if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
						// MUST be absolute: a <base href> pointing at the remote site is
						// injected, so a root-relative "/api/webproxy" would resolve to
						// https://<remote-host>/api/webproxy and CORS-fail. Build an
						// absolute same-origin URL instead.
						return window.location.origin + '/api/webproxy?u=' + encodeURIComponent(abs.href);
					} catch (e) { return null; }
				}
				try {
					if (window.fetch) {
						var _fetch = window.fetch;
						window.fetch = function(input, init) {
							try {
								if (typeof input === 'string') {
									var r = toProxy(input);
									if (r) input = r;
								} else if (input && input.url) {
									var r2 = toProxy(input.url);
									if (r2) input = new Request(r2, input);
								}
							} catch (e) {}
							return _fetch.call(this, input, init);
						};
					}
				} catch (e) {}
				try {
					var _open = XMLHttpRequest.prototype.open;
					XMLHttpRequest.prototype.open = function(method, url) {
						try {
							var r = toProxy(url);
							if (r) url = r;
						} catch (e) {}
						var args = Array.prototype.slice.call(arguments);
						args[0] = method;
						args[1] = url;
						return _open.apply(this, args);
					};
				} catch (e) {}
			})();

		})();
		</script>`, strconv.Quote(targetURL))

		if headRegex.MatchString(htmlStr) {
			htmlStr = headRegex.ReplaceAllString(htmlStr, "$0\n"+baseTag+"\n"+injectScript)
		} else {
			htmlStr = baseTag + "\n" + injectScript + "\n" + htmlStr
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		statusToWrite := resp.StatusCode
		if isDocRequest && (statusToWrite == http.StatusUnauthorized || statusToWrite == http.StatusForbidden || statusToWrite == http.StatusTooManyRequests) {
			statusToWrite = http.StatusOK
		}
		w.WriteHeader(statusToWrite)
		_, _ = w.Write([]byte(htmlStr))
		return
	}

	// For non-HTML static assets only (CSS, JS, images, fonts). API payloads
	// (JSON, XML) must never be cached here or a SPA would keep replaying stale
	// data instead of the fresh response the page just asked for.
	lc := strings.ToLower(contentType)
	cacheable := strings.Contains(lc, "text/css") || strings.Contains(lc, "javascript") ||
		strings.Contains(lc, "image/") || strings.Contains(lc, "font") ||
		strings.Contains(lc, "application/octet-stream")
	if cacheable && resp.StatusCode == http.StatusOK && resp.ContentLength > 0 && resp.ContentLength < 3*1024*1024 {
		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 3*1024*1024))
		if err == nil {
			setCachedAsset(targetURL, contentType, resp.StatusCode, bodyBytes, 30*time.Minute)
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(bodyBytes)
			return
		}
	}

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// writeBrowserError renders a branded, human-readable error page instead of a raw
// JSON blob, so a failed navigation never leaves the user staring at {"error":...}.
func writeBrowserError(w http.ResponseWriter, title, detail, target string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title>
	<style>
	:root{color-scheme:dark}
	*{box-sizing:border-box}
	body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 20%% 10%%,#12243f,#070b12 60%%);color:#e6edf6;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:40px}
	.card{max-width:560px;width:100%%;background:rgba(18,28,44,.72);border:1px solid rgba(120,170,255,.22);border-radius:22px;padding:34px 30px;backdrop-filter:blur(18px);box-shadow:0 24px 60px rgba(0,0,0,.5);text-align:center}
	.badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.4);color:#7dd3fc;font-size:12px;font-weight:700;letter-spacing:.14em}
	h1{margin:18px 0 10px;font-size:26px}
	p{margin:0 0 20px;color:#9fb3c8;line-height:1.6;font-size:15px}
	code{display:block;margin:0 0 22px;padding:12px 14px;border-radius:12px;background:rgba(0,0,0,.35);border:1px solid rgba(120,170,255,.16);color:#8fb6d9;font-size:13px;word-break:break-all}
	.row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
	button{cursor:pointer;font:inherit;font-weight:700;padding:12px 22px;border-radius:12px;border:1px solid rgba(120,170,255,.3);background:rgba(255,255,255,.06);color:#e6edf6}
	button.primary{background:linear-gradient(135deg,#38bdf8,#6366f1);border:0;color:#04121f}
	</style></head><body>
	<div class="card">
		<span class="badge">VYORA TV BROWSER</span>
		<h1>%s</h1>
		<p>%s</p>
		<code>%s</code>
		<div class="row">
			<button class="primary" onclick="location.reload()">Retry</button>
			<button onclick="history.back()">Back to Previous Page</button>
		</div>
	</div></body></html>`, html.EscapeString(title), html.EscapeString(title), html.EscapeString(detail), html.EscapeString(target))
}

// NOTE: the helpers that used to live here — ddgFallbackURL,
// engineDisplayName, searchEngineQuery, hasSearchResults, isChallengePage —
// were removed together with the silent DuckDuckGo swap. The Google-specific
// helpers (googleSearchURL, UnwrapRedirect, YouTubeVideoID, YouTubeEmbedURL,
// IsYouTubeHost) now live in search.go so the browser core has ONE copy.

