package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func main() {
	portFlag := flag.Int("port", 8787, "Port to listen on")
	dataDirFlag := flag.String("data", "server/data", "Path to data directory")
	webDirFlag := flag.String("web", "web/dist", "Path to web dist directory")
	flag.Parse()

	// Locate data directory
	dataDir := *dataDirFlag
	if _, err := os.Stat(filepath.Join(dataDir, "index.json")); err != nil {
		// Try fallback relative path
		if _, err2 := os.Stat("data/index.json"); err2 == nil {
			dataDir = "data"
		}
	}

	webDir := *webDirFlag
	if _, err := os.Stat(filepath.Join(webDir, "index.html")); err != nil {
		if _, err2 := os.Stat("../web/dist/index.html"); err2 == nil {
			webDir = "../web/dist"
		}
	}

	statusFile := filepath.Join(dataDir, "status.json")
	logosDir := filepath.Join(dataDir, "logos")

	store := NewStore(dataDir)
	health := NewHealthStore(statusFile, store)
	store.AttachHealth(health)

	if err := store.Load(); err != nil {
		log.Fatalf("[FATAL] Could not load IPTV catalog: %v", err)
	}

	proxyMgr := NewProxyManager(logosDir, health)
	health.StartWorkerPool(8) // 8 concurrent goroutines for stream probing

	// Zero-Delay Active Standby Pre-warmer for instant channel playback
	prewarmer := NewStandbyPreWarmer(store, proxyMgr, health)
	prewarmer.Start()

	// Download & Media Manager for Movies and TV Apps (APKs)
	dlMgr := InitDownloadManager(dataDir)

	// Queue top home channels for immediate health probing
	var topIDs []string
	for _, ch := range store.GetTop(150) {
		topIDs = append(topIDs, ch.ID)
	}
	health.Track(topIDs)

	mux := http.NewServeMux()

	// Browser core: Google suggestions, bookmarks, history, settings.
	browserAPI := NewBrowserAPI()
	browserStore := NewBrowserStore(filepath.Join(dataDir, "browser.json"))
	RegisterBrowserRoutes(mux, browserAPI, browserStore)

	// API Handler
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api")
		if path == "" {
			path = "/"
		}

		switch {
		case path == "/health":
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":  "ok",
				"engine":  "go-1.26",
				"time":    time.Now().UTC().Format(time.RFC3339),
				"dataset": store.Stats(),
				"health":  health.Stats(),
			})

		case path == "/bootstrap":
			idx := store.GetIndex()
			if idx == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not-loaded"})
				return
			}
			writeJSON(w, http.StatusOK, idx)

		case path == "/countries":
			writeJSON(w, http.StatusOK, map[string]interface{}{"countries": store.GetCountries()})

		case path == "/categories":
			writeJSON(w, http.StatusOK, map[string]interface{}{"categories": store.GetCategories()})

		case path == "/top":
			limit := 84
			if lStr := r.URL.Query().Get("limit"); lStr != "" {
				if n, err := strconv.Atoi(lStr); err == nil && n > 0 {
					limit = n
				}
			}
			onlyOnline := r.URL.Query().Get("online") == "1" || r.URL.Query().Get("online") == "true"
			store.RebuildTop()
			top := store.GetTop(limit)
			if onlyOnline && health != nil {
				var filtered []*Channel
				for _, ch := range top {
					rec := health.Get(ch.ID)
					if rec != nil && rec.Status == "online" {
						filtered = append(filtered, ch)
					}
				}
				top = filtered
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"total":    len(top),
				"channels": top,
			})

		case path == "/channels":
			idsParam := r.URL.Query().Get("ids")
			if idsParam != "" {
				ids := strings.Split(idsParam, ",")
				channels := store.GetByIds(ids)
				writeJSON(w, http.StatusOK, map[string]interface{}{
					"total":    len(channels),
					"count":    len(channels),
					"channels": channels,
				})
				return
			}

			country := r.URL.Query().Get("country")
			category := r.URL.Query().Get("category")
			search := r.URL.Query().Get("search")
			limit := 800
			offset := 0
			if lStr := r.URL.Query().Get("limit"); lStr != "" {
				if n, err := strconv.Atoi(lStr); err == nil && n > 0 {
					limit = n
				}
			}
			if oStr := r.URL.Query().Get("offset"); oStr != "" {
				if n, err := strconv.Atoi(oStr); err == nil && n >= 0 {
					offset = n
				}
			}

			onlyOnline := r.URL.Query().Get("online") == "1" || r.URL.Query().Get("online") == "true"
			channels, total := store.Query(country, category, search, limit, offset, onlyOnline)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"country":  country,
				"category": category,
				"search":   search,
				"total":    total,
				"count":    len(channels),
				"offset":   offset,
				"limit":    limit,
				"channels": channels,
			})

		case strings.HasPrefix(path, "/channels/"):
			id := strings.TrimPrefix(path, "/channels/")
			ch := store.GetChannel(id)
			if ch == nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "not-found"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"channel": ch})

		case strings.HasPrefix(path, "/resolve/"):
			id := strings.TrimPrefix(path, "/resolve/")
			ch := store.GetChannel(id)
			if ch == nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "not-found"})
				return
			}
			if len(ch.Streams) == 0 {
				writeJSON(w, http.StatusOK, map[string]interface{}{"ok": false, "error": "no-streams", "channel": ch})
				return
			}

			rec := health.Get(id)
			bestIdx := 0
			if rec != nil && rec.BestStream >= 0 && rec.BestStream < len(ch.Streams) {
				bestIdx = rec.BestStream
			}

			// Race every source in parallel - the fastest one wins. Waiting
			// for one source alone is what used to cause the blank screen.
			// The race order puts the health-proven source first, but the
			// mapping back to channel.streams is kept so the index we report
			// is the real one the player has to use.
			ordered, origIdx := health.OrderStreams(ch)
			if rec != nil && len(rec.Sources) == 0 && bestIdx != 0 {
				ordered = make([]Stream, 0, len(ch.Streams))
				origIdx = make([]int, 0, len(ch.Streams))
				ordered = append(ordered, ch.Streams[bestIdx])
				origIdx = append(origIdx, bestIdx)
				for i, stream := range ch.Streams {
					if i != bestIdx { ordered = append(ordered, stream); origIdx = append(origIdx, i) }
				}
			}

			limit := 4
			if len(ordered) < limit {
				limit = len(ordered)
			}
			winIdx, ok, ms := proxyMgr.RaceStreams(ordered, ch.ID, limit)
			if ok {
				realIdx := origIdx[winIdx]
				winner := ch.Streams[realIdx]
				health.Set(id, "online", ms, "resolve", realIdx)
				writeJSON(w, http.StatusOK, map[string]interface{}{
					"ok":          true,
					"channel":     ch,
					"streamIndex": realIdx,
					"stream":      winner,
					"ms":          ms,
				})
				return
			}

			// Every source we tried is dead or stalled. Answer honestly: the
			// client then keeps its own failover going instead of sitting on
			// its long playback watchdog for a source that cannot work.
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":          false,
				"error":       "all-sources-failed",
				"channel":     ch,
				"streamIndex": bestIdx,
				"ms":          ms,
			})

		case path == "/search":
			q := r.URL.Query().Get("q")
			limit := 120
			if lStr := r.URL.Query().Get("limit"); lStr != "" {
				if n, err := strconv.Atoi(lStr); err == nil && n > 0 {
					limit = n
				}
			}
			onlyOnline := r.URL.Query().Get("online") == "1" || r.URL.Query().Get("online") == "true"
			channels, total := store.Query("all", "all", q, limit, 0, onlyOnline)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"query":    q,
				"total":    total,
				"channels": channels,
			})

		case path == "/proxy":
			proxyMgr.ProxyStream(w, r)

		case path == "/play":
			// Stream racing: every source of the channel is tried in parallel
			// and the fastest one wins. The player is redirected to it, so the
			// picture starts from RAM instead of waiting for a slow CDN.
			cid := r.URL.Query().Get("cid")
			ch := store.GetChannel(cid)
			if ch == nil || len(ch.Streams) == 0 {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "channel-not-found"})
				return
			}

			candidates, originalIndices := health.OrderStreams(ch)
			if rec := health.Get(cid); rec != nil && len(rec.Sources) == 0 && rec.BestStream > 0 && rec.BestStream < len(candidates) {
				candidates = make([]Stream, 0, len(ch.Streams))
				originalIndices = make([]int, 0, len(ch.Streams))
				candidates = append(candidates, ch.Streams[rec.BestStream])
				originalIndices = append(originalIndices, rec.BestStream)
				for i, stream := range ch.Streams {
					if i != rec.BestStream { candidates = append(candidates, stream); originalIndices = append(originalIndices, i) }
				}
			}

			limit := 4
			if lStr := r.URL.Query().Get("n"); lStr != "" {
				if n, err := strconv.Atoi(lStr); err == nil && n > 0 && n <= 8 {
					limit = n
				}
			}

			idx, ok, ms := proxyMgr.RaceStreams(candidates, cid, limit)
			if !ok {
				if health != nil {
					health.Set(cid, "offline", ms, "race", 0)
				}
				writeJSON(w, http.StatusBadGateway, map[string]interface{}{
					"error": "all-sources-failed",
					"ms":    ms,
				})
				return
			}

			st := candidates[idx]
			realIndex := originalIndices[idx]
			w.Header().Set("Location", buildProxyURL(st.URL, st.Referer, st.UA, cid))
			w.Header().Set("X-Vyora-Stream", strconv.Itoa(realIndex))
			w.Header().Set("X-Vyora-Ms", strconv.Itoa(ms))
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusFound)

		case path == "/warm":
			// Pre-warm the channels the user is looking at: manifest + first
			// segments go into RAM, so the click is instant.
			idsParam := r.URL.Query().Get("ids")
			depth := 2
			if dStr := r.URL.Query().Get("depth"); dStr != "" {
				if n, err := strconv.Atoi(dStr); err == nil && n > 0 && n <= 4 {
					depth = n
				}
			}
			ids := strings.Split(idsParam, ",")
			warmed := 0
			for _, id := range ids {
				id = strings.TrimSpace(id)
				if id == "" {
					continue
				}
				ch := store.GetChannel(id)
				if ch == nil || len(ch.Streams) == 0 {
					continue
				}
				take := depth
				if take > len(ch.Streams) {
					take = len(ch.Streams)
				}
				for _, st := range ch.Streams[:take] {
					go proxyMgr.Prefetch(st.URL, st.Referer, st.UA, id)
					warmed++
				}
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":       true,
				"warmed":   warmed,
				"channels": len(ids),
			})

		case path == "/status":
			idsParam := r.URL.Query().Get("ids")
			if idsParam != "" {
				ids := strings.Split(idsParam, ",")
				out := make(map[string]*HealthRecord)
				for _, id := range ids {
					id = strings.TrimSpace(id)
					if id != "" {
						out[id] = health.Get(id)
					}
				}
				writeJSON(w, http.StatusOK, map[string]interface{}{
					"status": out,
					"stats":  health.Stats(),
				})
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status": health.GetAll(),
				"stats":  health.Stats(),
			})

		case path == "/status/stream":
			health.SubscribeSSE(w, r)

		case path == "/status/report":
			id := r.URL.Query().Get("id")
			okVal := r.URL.Query().Get("ok")
			ok := okVal == "1" || okVal == "true"
			ms, _ := strconv.Atoi(r.URL.Query().Get("ms"))
			streamIdx, _ := strconv.Atoi(r.URL.Query().Get("stream"))
			if id != "" {
				health.ReportSource(id, ok, ms, streamIdx)
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":     true,
				"id":     id,
				"status": health.Get(id),
			})

		case path == "/status/track":
			idsParam := r.URL.Query().Get("ids")
			ids := strings.Split(idsParam, ",")
			health.Track(ids)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"tracked": len(ids),
			})

		case path == "/playback/active":
			cid := r.URL.Query().Get("cid")
			health.SetActivePlayback(true, cid)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":     true,
				"active": true,
				"cid":    cid,
			})

		case path == "/playback/inactive":
			health.SetActivePlayback(false, "")
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":     true,
				"active": false,
			})

		case path == "/playback/lookahead":
			idsParam := r.URL.Query().Get("ids")
			ids := strings.Split(idsParam, ",")
			var prefetched []string
			for _, id := range ids {
				id = strings.TrimSpace(id)
				if ch := store.GetChannel(id); ch != nil && len(ch.Streams) > 0 {
					go func(targetCh *Channel) {
						s := targetCh.Streams[0]
						proxyMgr.Prefetch(s.URL, s.Referer, s.UA, targetCh.ID)
					}(ch)
					prefetched = append(prefetched, id)
				}
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":         true,
				"prefetched": prefetched,
			})

		case path == "/prefetch":
			q := r.URL.Query()
			targetURL := decodeParam(q.Get("u"))
			referer := decodeParam(q.Get("r"))
			ua := decodeParam(q.Get("a"))
			cid := q.Get("cid")
			if targetURL != "" {
				// Fast lane: the user is pointing at this channel right now.
				go proxyMgr.PrefetchFast(targetURL, referer, ua, cid)
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "queued": true})

		case path == "/network":
			writeJSON(w, http.StatusOK, proxyMgr.NetworkInfo())

		case path == "/vod/index":
			vodIndexPath := filepath.Join(dataDir, "vod", "index.json")
			if data, err := os.ReadFile(vodIndexPath); err == nil {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(data)
			} else {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "vod-index-not-found"})
			}

		case path == "/vod/movies":
			moviesPath := filepath.Join(dataDir, "vod", "movies.json")
			if data, err := os.ReadFile(moviesPath); err == nil {
				genre := strings.ToLower(r.URL.Query().Get("genre"))
				search := strings.ToLower(r.URL.Query().Get("q"))
				limit := 0
				if lStr := r.URL.Query().Get("limit"); lStr != "" {
					limit, _ = strconv.Atoi(lStr)
				}

				if genre == "" && search == "" && limit == 0 {
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set("Access-Control-Allow-Origin", "*")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(data)
					return
				}

				var allMovies []map[string]interface{}
				if err := json.Unmarshal(data, &allMovies); err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}

				var filtered []map[string]interface{}
				for _, m := range allMovies {
					if genre != "" && genre != "all" {
						mg, _ := m["genre"].(string)
						if strings.ToLower(mg) != genre {
							continue
						}
					}
					if search != "" {
						title, _ := m["title"].(string)
						if !strings.Contains(strings.ToLower(title), search) {
							continue
						}
					}
					filtered = append(filtered, m)
					if limit > 0 && len(filtered) >= limit {
						break
					}
				}
				writeJSON(w, http.StatusOK, filtered)
			} else {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "vod-movies-not-found"})
			}

		case path == "/vod/series":
			seriesPath := filepath.Join(dataDir, "vod", "series.json")
			if data, err := os.ReadFile(seriesPath); err == nil {
				genre := strings.ToLower(r.URL.Query().Get("genre"))
				search := strings.ToLower(r.URL.Query().Get("q"))
				limit := 0
				if lStr := r.URL.Query().Get("limit"); lStr != "" {
					limit, _ = strconv.Atoi(lStr)
				}

				if genre == "" && search == "" && limit == 0 {
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set("Access-Control-Allow-Origin", "*")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(data)
					return
				}

				var allSeries []map[string]interface{}
				if err := json.Unmarshal(data, &allSeries); err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}

				var filtered []map[string]interface{}
				for _, s := range allSeries {
					if genre != "" && genre != "all" {
						sg, _ := s["genre"].(string)
						if strings.ToLower(sg) != genre {
							continue
						}
					}
					if search != "" {
						title, _ := s["title"].(string)
						if !strings.Contains(strings.ToLower(title), search) {
							continue
						}
					}
					filtered = append(filtered, s)
					if limit > 0 && len(filtered) >= limit {
						break
					}
				}
				writeJSON(w, http.StatusOK, filtered)
			} else {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "vod-series-not-found"})
			}

		case path == "/logo":
			proxyMgr.ProxyLogo(w, r)

		case path == "/webproxy":
			proxyMgr.ProxyWeb(w, r)

		case path == "/downloads":
			dlMgr.HandleList(w, r)

		case path == "/downloads/start":
			dlMgr.HandleStart(w, r)

		case path == "/downloads/delete":
			dlMgr.HandleDelete(w, r)

		case path == "/downloads/file":
			dlMgr.HandleServeFile(w, r)

		case path == "/proxy-url":
			target := r.URL.Query().Get("u")
			referer := r.URL.Query().Get("r")
			ua := r.URL.Query().Get("a")
			cid := r.URL.Query().Get("cid")
			writeJSON(w, http.StatusOK, map[string]string{
				"url": buildProxyURL(target, referer, ua, cid),
			})

		case path == "/xtream/auth":
			handleXtreamAuth(w, r, proxyMgr.client)

		case path == "/xtream/categories":
			handleXtreamCategories(w, r, proxyMgr.client)

		case path == "/xtream/streams":
			handleXtreamStreams(w, r, proxyMgr.client)

		case path == "/playlist/m3u":
			handleM3UImport(w, r, proxyMgr.client)

		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "route-not-found"})
		}
	})

	// Direct root endpoints for logo and webproxy (convenience aliases)
	mux.HandleFunc("/logo", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		proxyMgr.ProxyLogo(w, r)
	})

	mux.HandleFunc("/webproxy", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		proxyMgr.ProxyWeb(w, r)
	})

	// Static file handler with SPA fallback
	fs := http.FileServer(http.Dir(webDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/logo" || r.URL.Path == "/webproxy" {
			return
		}
		path := filepath.Join(webDir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		// SPA Fallback: serve index.html
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})

	// Alt-Svc clearing middleware: upstream CDNs (YouTube, Google, etc.) advertise
	// HTTP/3 via Alt-Svc, and any such header that ever reached the browser got
	// cached against *this* origin for up to 30 days. Chrome then tried an
	// h3/ALPN connection to the local server, failed the TLS upgrade, and killed
	// every later same-origin request (ERR_ALPN_NEGOTIATION_FAILED) — which is
	// why proxied youtubei/v1/player calls never answered. The proxy already
	// strips Alt-Svc downstream; this also proactively clears any entry the
	// browser may still hold.
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Alt-Svc", "clear")
		mux.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf(":%d", *portFlag)
	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan
		log.Println("[SHUTDOWN] Gracefully saving state and stopping Go server...")
		prewarmer.Stop()
		health.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
		log.Println("[SHUTDOWN] Vyora TV Go Engine stopped.")
	}()

	fmt.Println("==================================================")
	fmt.Printf("  ⚡ VYORA TV - HIGH-PERFORMANCE GO ENGINE v1.0.0 ⚡\n")
	fmt.Printf("  Serving on: http://localhost:%d\n", *portFlag)
	fmt.Printf("  Catalog:    %d channels loaded in memory\n", len(store.allChannels))
	fmt.Printf("  Proxy:      Zero-Copy 64KB HLS Stream Pipe Active\n")
	fmt.Printf("  Workers:    Goroutine Stream Pre-Warmer Online\n")
	fmt.Println("==================================================")

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[FATAL] HTTP server error: %v", err)
	}
}
