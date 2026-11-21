package main

import (
	"log"
	"time"
)

// StandbyPreWarmer continuously maintains RAM-cached manifests and initial segments
// for the top channels so that whenever the user clicks ANY top channel,
// playback starts with ZERO latency and ZERO buffering.
type StandbyPreWarmer struct {
	store    *Store
	proxyMgr *ProxyManager
	health   *HealthStore
	stopChan chan struct{}
}

func NewStandbyPreWarmer(store *Store, proxyMgr *ProxyManager, health *HealthStore) *StandbyPreWarmer {
	return &StandbyPreWarmer{
		store:    store,
		proxyMgr: proxyMgr,
		health:   health,
		stopChan: make(chan struct{}),
	}
}

func (spw *StandbyPreWarmer) Start() {
	go func() {
		// Initial burst pre-warming 1.5s after server starts
		time.Sleep(1500 * time.Millisecond)
		log.Println("[STANDBY] Initializing zero-delay standby pre-warming for top channels...")
		spw.warmTopChannels()

		// Continuous background refresh every 12 seconds (HLS live segments rotate
		// every 6-10s, so the warm copy has to stay close to the live edge)
		ticker := time.NewTicker(12 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				spw.warmTopChannels()
			case <-spw.stopChan:
				return
			}
		}
	}()
}

func (spw *StandbyPreWarmer) warmTopChannels() {
	// Pick the top 24 channels from store
	top := spw.store.GetTop(24)
	if len(top) == 0 {
		return
	}

	for _, ch := range top {
		if len(ch.Streams) == 0 {
			continue
		}
		// Pick best stream according to health or default to stream 0
		bestIdx := 0
		if spw.health != nil {
			if rec := spw.health.Get(ch.ID); rec != nil && rec.BestStream >= 0 && rec.BestStream < len(ch.Streams) {
				bestIdx = rec.BestStream
			}
		}
		st := ch.Streams[bestIdx]
		// Run in background goroutine with low priority
		go func(targetURL, ref, ua, cid string) {
			// Manifest only: the media segments are warmed when the user points at
			// the channel, so the standby loop does not eat the bandwidth.
			_, _ = spw.proxyMgr.PrefetchLight(targetURL, ref, ua, cid)
		}(st.URL, st.Referer, st.UA, ch.ID)
	}
}

func (spw *StandbyPreWarmer) Stop() {
	close(spw.stopChan)
}
