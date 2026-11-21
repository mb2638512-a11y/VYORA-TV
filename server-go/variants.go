package main

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Dead master-playlist variants are a very common IPTV problem: the master
// playlist is alive but the child variants it advertises are already dead.
// The player then burns three level-load attempts on 404s before it gives up
// - that is the "Attempt 4/2 ... then it opens late" behaviour.
//
// The proxy therefore validates the variants and removes the dead ones, so
// the player only ever sees levels that really work.

type variantHealth struct {
	alive bool
	ts    time.Time
}

var variantHealthCache sync.Map // target -> *variantHealth

// childProbeTimeout bounds a single variant probe. A reachable CDN answers a
// playlist in a few hundred milliseconds; waiting longer only delays the
// channel start.
const childProbeTimeout = 1000 * time.Millisecond

// variantProbeBudget bounds the total time spent pruning the variants of one
// master playlist. Whatever has not answered by then is kept, never dropped.
const variantProbeBudget = 1000 * time.Millisecond

// childAlive checks whether a child playlist answers. The result is cached
// for 30 seconds so repeated playbacks do not re-probe.
func (pm *ProxyManager) childAlive(target, referer, ua string) bool {
	if target == "" {
		return false
	}
	if v, ok := variantHealthCache.Load(target); ok {
		if vh, ok := v.(*variantHealth); ok && time.Since(vh.ts) < 30*time.Second {
			return vh.alive
		}
	}

	alive := false
	ctx, cancel := context.WithTimeout(context.Background(), childProbeTimeout)
	defer cancel()

	resp, err := pm.fetchWithDualRace(ctx, "GET", target, referer, ua, http.Header{})
	if err == nil && resp != nil {
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			alive = true
		}
		resp.Body.Close()
	}

	variantHealthCache.Store(target, &variantHealth{alive: alive, ts: time.Now()})
	return alive
}

// pruneMasterVariants removes the dead variants of a master playlist.
// The second return value is false when every variant is dead - the caller
// then fails over to the next source immediately instead of letting the
// player retry three broken levels.
func (pm *ProxyManager) pruneMasterVariants(rewritten, referer, ua string) (string, bool) {
	if !strings.Contains(rewritten, "#EXT-X-STREAM-INF") {
		return rewritten, true
	}

	lines := strings.Split(rewritten, "\n")

	// Collect the variants (header line + uri line) first.
	type variant struct {
		headIdx int
		uriIdx  int
		target  string
	}
	var variants []variant

	for i := 0; i < len(lines); i++ {
		if !strings.HasPrefix(strings.TrimSpace(lines[i]), "#EXT-X-STREAM-INF") {
			continue
		}
		j := i + 1
		for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
			j++
		}
		if j >= len(lines) {
			break
		}
		uri := strings.TrimSpace(lines[j])
		target := ""
		if strings.HasPrefix(uri, "/api/proxy?") {
			if parsed, err := url.Parse(uri); err == nil {
				target = decodeParam(parsed.Query().Get("u"))
			}
		}
		variants = append(variants, variant{headIdx: i, uriIdx: j, target: target})
		i = j
	}

	if len(variants) == 0 {
		return rewritten, true
	}

	// Probe every variant in parallel, but never longer than the probe
	// budget: a stalling CDN must not delay the channel start. A variant is
	// dropped only when it answered and was dead - a probe that is still
	// pending when the budget expires is kept.
	alive := make([]bool, len(variants))
	answered := make([]bool, len(variants))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for idx, v := range variants {
		wg.Add(1)
		go func(idx int, target string) {
			defer wg.Done()
			ok := target != "" && pm.childAlive(target, referer, ua)
			mu.Lock()
			alive[idx] = ok
			answered[idx] = true
			mu.Unlock()
		}(idx, v.target)
	}

	probed := make(chan struct{})
	go func() {
		wg.Wait()
		close(probed)
	}()

	select {
	case <-probed:
	case <-time.After(variantProbeBudget):
	}

	mu.Lock()
	aliveSnap := append([]bool(nil), alive...)
	answeredSnap := append([]bool(nil), answered...)
	mu.Unlock()

	// Rebuild the playlist without the dead variants.
	drop := make(map[int]bool)
	kept := 0
	for idx, v := range variants {
		if aliveSnap[idx] || !answeredSnap[idx] {
			kept++
		} else {
			drop[v.headIdx] = true
			drop[v.uriIdx] = true
		}
	}

	if kept == 0 {
		return "", false
	}

	out := make([]string, 0, len(lines))
	for i, line := range lines {
		if drop[i] {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n"), true
}
