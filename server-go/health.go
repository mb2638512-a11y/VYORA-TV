package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// HealthStore manages channel status, SSE broadcasting, and background health checks.
type HealthStore struct {
	mu             sync.RWMutex
	status         map[string]*HealthRecord
	subscribers    map[chan *HealthRecord]struct{}
	subMu          sync.Mutex
	priorityQueue  []string
	priorityMu     sync.Mutex
	catalogCursor  atomic.Uint64
	catalogSlots   chan struct{}
	activePlayback atomic.Bool
	activeCID      atomic.Value // string
	statusFile   string
	directClient *http.Client
	tunnelClient *http.Client
	store        *Store
	saveTicker   *time.Ticker
	stopChan     chan struct{}
}

func NewHealthStore(statusFile string, store *Store) *HealthStore {
	directTransport := &http.Transport{
		Proxy: nil, // DIRECT CONNECTION
		DialContext: (&net.Dialer{
			Timeout:   3000 * time.Millisecond,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          250,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       45 * time.Second,
		TLSHandshakeTimeout:   3000 * time.Millisecond,
		ExpectContinueTimeout: 1 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
			NextProtos:         []string{"http/1.1"},
		},
		TLSNextProto: make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}
	directClient := &http.Client{
		Transport: directTransport,
		Timeout:   8 * time.Second,
	}

	proxyURL, _ := url.Parse("http://127.0.0.1:8080")
	tunnelTransport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL), // LOCAL TUNNEL
		DialContext: (&net.Dialer{
			Timeout:   5000 * time.Millisecond,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          250,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       45 * time.Second,
		TLSHandshakeTimeout:   5000 * time.Millisecond,
		ExpectContinueTimeout: 1 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
			NextProtos:         []string{"http/1.1"},
		},
		TLSNextProto: make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}
	tunnelClient := &http.Client{
		Transport: tunnelTransport,
		Timeout:   10 * time.Second,
	}

	h := &HealthStore{
		status:       make(map[string]*HealthRecord),
		subscribers:  make(map[chan *HealthRecord]struct{}),
		statusFile:   statusFile,
		directClient: directClient,
		tunnelClient: tunnelClient,
		store:        store,
		stopChan:     make(chan struct{}),
		catalogSlots: make(chan struct{}, 2),
	}
	h.activeCID.Store("")

	h.load()
	h.startPeriodicSave()
	return h
}

func (h *HealthStore) load() {
	h.mu.Lock()
	defer h.mu.Unlock()

	data, err := os.ReadFile(h.statusFile)
	if err != nil {
		log.Printf("[HEALTH] No existing status.json found at %s (starting fresh)", h.statusFile)
		return
	}

	if err := json.Unmarshal(data, &h.status); err != nil {
		log.Printf("[HEALTH] Could not parse status.json: %v", err)
		return
	}

	// Sanitize loaded statuses: remove false offline probe records
	pruned := 0
	for id, rec := range h.status {
		if rec.Status == "offline" && rec.Source == "probe" {
			delete(h.status, id)
			pruned++
		}
	}
	if pruned > 0 {
		log.Printf("[HEALTH] Pruned %d stale/false offline probe records from disk", pruned)
	}

	log.Printf("[HEALTH] Loaded %d active channel status records from disk", len(h.status))
}

func (h *HealthStore) Save() {
	h.mu.RLock()
	data, err := json.Marshal(h.status)
	h.mu.RUnlock()

	if err != nil {
		log.Printf("[HEALTH] Failed to marshal status: %v", err)
		return
	}

	tmpFile := h.statusFile + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err == nil {
		_ = os.Rename(tmpFile, h.statusFile)
	}
}

func (h *HealthStore) startPeriodicSave() {
	h.saveTicker = time.NewTicker(20 * time.Second)
	go func() {
		for {
			select {
			case <-h.saveTicker.C:
				h.Save()
			case <-h.stopChan:
				h.Save()
				return
			}
		}
	}()
}

func (h *HealthStore) Close() {
	close(h.stopChan)
	if h.saveTicker != nil {
		h.saveTicker.Stop()
	}
	h.Save()
}

func (h *HealthStore) Get(id string) *HealthRecord {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.status[id]
}

func (h *HealthStore) GetAll() map[string]*HealthRecord {
	h.mu.RLock()
	defer h.mu.RUnlock()
	copyMap := make(map[string]*HealthRecord, len(h.status))
	for k, v := range h.status {
		copyMap[k] = v
	}
	return copyMap
}

func (h *HealthStore) Set(id, status string, ms int, source string, bestStream int) {
	rec := &HealthRecord{
		ID:         id,
		Status:     status,
		TS:         time.Now().UnixMilli(),
		MS:         ms,
		Source:     source,
		BestStream: bestStream,
	}

	h.mu.Lock()
	h.status[id] = rec
	h.mu.Unlock()

	h.broadcast(rec)
}

func (h *HealthStore) Report(id string, ok bool, ms, streamIndex int) {
	status := "offline"
	if ok {
		status = "online"
	}
	h.Set(id, status, ms, "playback", streamIndex)
}

func (h *HealthStore) Track(ids []string) {
	h.priorityMu.Lock()
	defer h.priorityMu.Unlock()
	// Prepend ids to priority queue
	for i := len(ids) - 1; i >= 0; i-- {
		id := ids[i]
		if id != "" {
			h.priorityQueue = append([]string{id}, h.priorityQueue...)
		}
	}
	if len(h.priorityQueue) > 1000 {
		h.priorityQueue = h.priorityQueue[:1000]
	}
}

func (h *HealthStore) SetActivePlayback(active bool, cid string) {
	h.activePlayback.Store(active)
	h.activeCID.Store(cid)
	if active {
		log.Printf("[BANDWIDTH] 100%% Bandwidth locked for active playback on channel '%s' (background sweeper paused)", cid)
	} else {
		log.Printf("[BANDWIDTH] Playback stopped - background sweeper resumed")
	}
}

func (h *HealthStore) Stats() HealthStats {
	h.mu.RLock()
	defer h.mu.RUnlock()

	online := 0
	offline := 0
	for _, rec := range h.status {
		if rec.Status == "online" {
			online++
		} else if rec.Status == "offline" {
			offline++
		}
	}

	return HealthStats{
		Online:  online,
		Offline: offline,
		Total:   len(h.status),
		Rate:    online,
	}
}

func (h *HealthStore) broadcast(rec *HealthRecord) {
	h.subMu.Lock()
	defer h.subMu.Unlock()

	for ch := range h.subscribers {
		select {
		case ch <- rec:
		default:
			// Non-blocking drop if client is slow
		}
	}
}

func (h *HealthStore) SubscribeSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	clientChan := make(chan *HealthRecord, 64)
	h.subMu.Lock()
	h.subscribers[clientChan] = struct{}{}
	h.subMu.Unlock()

	defer func() {
		h.subMu.Lock()
		delete(h.subscribers, clientChan)
		h.subMu.Unlock()
		close(clientChan)
	}()

	// Initial ping + full catalog snapshot so client cards update instantly
	fmt.Fprintf(w, ":keep-alive\n\n")
	flusher.Flush()

	h.mu.RLock()
	snapData, err := json.Marshal(h.status)
	h.mu.RUnlock()
	if err == nil {
		fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", snapData)
		flusher.Flush()
	}

	keepAliveTicker := time.NewTicker(15 * time.Second)
	defer keepAliveTicker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-keepAliveTicker.C:
			fmt.Fprintf(w, ":keep-alive\n\n")
			flusher.Flush()
		case rec, ok := <-clientChan:
			if !ok {
				return
			}
			data, err := json.Marshal(rec)
			if err == nil {
				fmt.Fprintf(w, "event: status\ndata: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

// StartWorkerPool runs concurrent probe goroutines that test channels.
func (h *HealthStore) StartWorkerPool(numWorkers int) {
	for i := 0; i < numWorkers; i++ {
		go h.workerLoop(i)
	}
	log.Printf("[HEALTH] Started %d concurrent channel health workers", numWorkers)
}

func (h *HealthStore) workerLoop(workerID int) {
	for {
		// Respect Active Playback: When user is watching TV, PAUSE background sweeper!
		if h.activePlayback.Load() {
			time.Sleep(600 * time.Millisecond)
			continue
		}

		var targetID string

		// Check priority queue first
		h.priorityMu.Lock()
		if len(h.priorityQueue) > 0 {
			targetID = h.priorityQueue[0]
			h.priorityQueue = h.priorityQueue[1:]
		}
		h.priorityMu.Unlock()

		if targetID == "" {
			// Low-priority rolling catalogue sweep. Only two workers may scan
			// the public source catalogue at once, and the whole sweep pauses
			// while a viewer is actively watching a channel.
			select {
			case h.catalogSlots <- struct{}{}:
			default:
				time.Sleep(300 * time.Millisecond)
				continue
			}

			ch := h.nextCatalogChannel()
			if ch == nil || len(ch.Streams) == 0 {
				<-h.catalogSlots
				time.Sleep(250 * time.Millisecond)
				continue
			}
			if h.catalogRecordIsFresh(ch.ID) {
				<-h.catalogSlots
				time.Sleep(100 * time.Millisecond)
				continue
			}

			h.probeChannel(ch)
			<-h.catalogSlots
			time.Sleep(150 * time.Millisecond)
			continue
		}

		ch := h.store.GetChannel(targetID)
		if ch == nil || len(ch.Streams) == 0 {
			continue
		}

		h.probeChannel(ch)
		time.Sleep(150 * time.Millisecond)
	}
}

// nextCatalogChannel walks every loaded channel in a stable round-robin order.
// The cursor is process-local; persisted health records prevent needless repeats
// after a restart.
func (h *HealthStore) nextCatalogChannel() *Channel {
	if h.store == nil {
		return nil
	}
	total := h.store.ChannelCount()
	if total == 0 {
		return nil
	}
	index := int((h.catalogCursor.Add(1) - 1) % uint64(total))
	return h.store.GetChannelAt(index)
}

// catalogRecordIsFresh avoids repeatedly probing channels that were recently
// confirmed. Online records stay fresh for 20 minutes; confirmed offline
// records for 5 minutes; unknown records for 2 minutes.
func (h *HealthStore) catalogRecordIsFresh(id string) bool {
	rec := h.Get(id)
	if rec == nil {
		return false
	}
	age := time.Since(time.UnixMilli(rec.TS))
	switch rec.Status {
	case "online":
		return age < 20*time.Minute
	case "offline":
		return age < 5*time.Minute
	default:
		return age < 2*time.Minute
	}
}

func (h *HealthStore) probeChannel(ch *Channel) {
	explicitDeadCount := 0
	totalStreams := len(ch.Streams)

	for idx, s := range ch.Streams {
		if s.URL == "" {
			explicitDeadCount++
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 6000*time.Millisecond)
		t0 := time.Now()

		req, err := http.NewRequestWithContext(ctx, "GET", s.URL, nil)
		if err != nil {
			cancel()
			continue
		}

		userAgent := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
		if s.UA != "" {
			userAgent = s.UA
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/vnd.apple.mpegurl, application/x-mpegurl, video/mp2t, application/octet-stream, */*")
		if s.Referer != "" {
			req.Header.Set("Referer", s.Referer)
		} else if u, err := url.Parse(s.URL); err == nil {
			req.Header.Set("Referer", fmt.Sprintf("%s://%s/", u.Scheme, u.Host))
			req.Header.Set("Origin", fmt.Sprintf("%s://%s", u.Scheme, u.Host))
		}

		resp, err := h.directClient.Do(req)
		ms := int(time.Since(t0).Milliseconds())
		if err != nil || (resp != nil && resp.StatusCode >= 400) {
			if resp != nil {
				resp.Body.Close()
			}
			// Fallback to local tunnel proxy
			t1 := time.Now()
			tunnelReq, tErr := http.NewRequestWithContext(ctx, "GET", s.URL, nil)
			if tErr == nil {
				tunnelReq.Header = req.Header.Clone()
				tResp, tErr2 := h.tunnelClient.Do(tunnelReq)
				if tErr2 == nil && tResp.StatusCode < 400 {
					resp = tResp
					err = nil
					ms = int(time.Since(t1).Milliseconds())
				} else if tResp != nil {
					tResp.Body.Close()
				}
			}
		}
		if err != nil || resp == nil {
			cancel()
			continue
		}

		// Read up to 4KB safely without ErrUnexpectedEOF
		buf, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		cancel()

		sample := string(buf)
		cType := strings.ToLower(resp.Header.Get("Content-Type"))

		// Detect definite HTML error/blocking pages
		isHtml := strings.Contains(cType, "text/html") || strings.Contains(sample, "<html") || strings.Contains(sample, "<!doctype") || strings.Contains(sample, "<!DOCTYPE")
		isBlockedOrError := strings.Contains(sample, "404 Not Found") ||
			strings.Contains(sample, "403 Forbidden") ||
			strings.Contains(sample, "Access Denied") ||
			strings.Contains(sample, "Attention Required! | Cloudflare") ||
			strings.Contains(sample, "Just a moment...") ||
			strings.Contains(sample, "Domain Default page") ||
			strings.Contains(sample, "Account Suspended")

		if isHtml && isBlockedOrError {
			explicitDeadCount++
			continue
		}

		// Valid stream returning 200..399
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			h.Set(ch.ID, "online", ms, "probe", idx)
			return
		}

		if resp.StatusCode == 404 || resp.StatusCode == 410 {
			explicitDeadCount++
		}
	}

	// Only declare offline if all streams returned confirmed dead 404/410/Domain Expired
	// Transient network congestion or latency spikes must NEVER falsely mark channels as offline!
	if totalStreams > 0 && explicitDeadCount >= totalStreams {
		h.Set(ch.ID, "offline", 3000, "probe", 0)
	}
}
