package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type searchItem struct {
	channel *Channel
	text    string
}

// Store holds the IPTV catalog in memory for sub-millisecond lookups.
type Store struct {
	mu              sync.RWMutex
	dataDir         string
	index           *BootstrapIndex
	channelsByID    map[string]*Channel
	countryChannels map[string][]*Channel
	allChannels     []*Channel
	searchIndex     []searchItem
	topChannels     []*Channel
	health          *HealthStore
}

func NewStore(dataDir string) *Store {
	return &Store{
		dataDir:         dataDir,
		channelsByID:    make(map[string]*Channel),
		countryChannels: make(map[string][]*Channel),
	}
}

func (s *Store) AttachHealth(h *HealthStore) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.health = h
}

func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	indexPath := filepath.Join(s.dataDir, "index.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return fmt.Errorf("read index.json: %w", err)
	}

	var idx BootstrapIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return fmt.Errorf("unmarshal index.json: %w", err)
	}
	s.index = &idx

	s.channelsByID = make(map[string]*Channel)
	s.countryChannels = make(map[string][]*Channel)
	s.allChannels = make([]*Channel, 0, idx.Totals.Channels)
	s.searchIndex = make([]searchItem, 0, idx.Totals.Channels)

	channelsDir := filepath.Join(s.dataDir, "channels")
	entries, err := os.ReadDir(channelsDir)
	if err != nil {
		return fmt.Errorf("read channels dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		countryCode := strings.ToUpper(strings.TrimSuffix(entry.Name(), ".json"))
		filePath := filepath.Join(channelsDir, entry.Name())
		chData, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var list []*Channel
		if err := json.Unmarshal(chData, &list); err != nil {
			continue
		}

		s.countryChannels[countryCode] = list
		for _, ch := range list {
			s.channelsByID[ch.ID] = ch
			s.allChannels = append(s.allChannels, ch)

			var hay strings.Builder
			hay.WriteString(strings.ToLower(ch.Name))
			hay.WriteByte(' ')
			hay.WriteString(strings.ToLower(ch.Country))
			hay.WriteByte(' ')
			hay.WriteString(strings.ToLower(ch.Network))
			hay.WriteByte(' ')
			hay.WriteString(strings.ToLower(ch.Owner))
			for _, a := range ch.Alt {
				hay.WriteByte(' ')
				hay.WriteString(strings.ToLower(a))
			}
			for _, cat := range ch.Categories {
				hay.WriteByte(' ')
				hay.WriteString(strings.ToLower(cat))
			}

			s.searchIndex = append(s.searchIndex, searchItem{
				channel: ch,
				text:    hay.String(),
			})
		}
	}

	s.buildTopLocked()

	log.Printf("[STORE] Loaded %d channels across %d countries from %s",
		len(s.allChannels), len(s.countryChannels), s.dataDir)
	return nil
}

func (s *Store) buildTopLocked() {
	score := func(ch *Channel) int {
		statusBonus := 0
		if s.health != nil {
			rec := s.health.Get(ch.ID)
			if rec != nil {
				if rec.Status == "online" {
					latency := rec.MS
					if latency > 2000 {
						latency = 2000
					}
					statusBonus = 25000 - latency
				} else if rec.Status == "offline" {
					statusBonus = -50000
				}
			}
		}

		qScore := 0
		if len(ch.Streams) > 0 {
			lbl := ch.Streams[0].Label
			if strings.Contains(lbl, "4K") {
				qScore = 2160
			} else if strings.Contains(lbl, "2K") {
				qScore = 1440
			} else {
				if n, err := strconv.Atoi(strings.TrimSuffix(lbl, "p")); err == nil {
					qScore = n
				}
			}
		}

		return statusBonus + (qScore * 10) + len(ch.Streams)
	}

	all := make([]*Channel, len(s.allChannels))
	copy(all, s.allChannels)

	sort.SliceStable(all, func(i, j int) bool {
		return score(all[i]) > score(all[j])
	})

	seen := make(map[string]bool)
	var top []*Channel

	// Diverse top: prioritize verified online channels and never pick confirmed offline ones
	for _, ch := range all {
		if s.health != nil {
			rec := s.health.Get(ch.ID)
			if rec != nil && rec.Status == "offline" {
				continue // Exclude confirmed offline channels
			}
		}
		if !seen[ch.Country] {
			seen[ch.Country] = true
			top = append(top, ch)
		}
		if len(top) >= 60 {
			break
		}
	}

	// Fill remaining up to 100 with online/healthy channels
	for _, ch := range all {
		if s.health != nil {
			rec := s.health.Get(ch.ID)
			if rec != nil && rec.Status == "offline" {
				continue
			}
		}
		if len(top) >= 100 {
			break
		}
		found := false
		for _, item := range top {
			if item.ID == ch.ID {
				found = true
				break
			}
		}
		if !found {
			top = append(top, ch)
		}
	}

	s.topChannels = top
}

func (s *Store) RebuildTop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buildTopLocked()
}

func (s *Store) GetIndex() *BootstrapIndex {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.index
}

func (s *Store) GetCountries() []Country {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.index == nil {
		return nil
	}
	return s.index.Countries
}

func (s *Store) GetCategories() []Category {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.index == nil {
		return nil
	}
	return s.index.Categories
}

func (s *Store) GetChannel(id string) *Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.channelsByID[id]
}

func (s *Store) GetByIds(ids []string) []*Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var res []*Channel
	for _, id := range ids {
		if ch, ok := s.channelsByID[id]; ok {
			res = append(res, ch)
		}
	}
	return res
}

func (s *Store) GetTop(limit int) []*Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 || limit > len(s.topChannels) {
		limit = len(s.topChannels)
	}
	return s.topChannels[:limit]
}

func matchCategory(categories []string, filter string) bool {
	if filter == "" || filter == "all" {
		return true
	}
	f := strings.ToLower(strings.TrimSpace(filter))
	for _, c := range categories {
		norm := strings.ToLower(strings.TrimSpace(c))
		if norm == f {
			return true
		}
		if f == "kids" && (strings.Contains(norm, "animat") || strings.Contains(norm, "cartoon") || strings.Contains(norm, "child") || strings.Contains(norm, "kids") || strings.Contains(norm, "toon")) {
			return true
		}
		if f == "movies" && (strings.Contains(norm, "movie") || strings.Contains(norm, "film") || strings.Contains(norm, "cinema")) {
			return true
		}
		if f == "sports" && (strings.Contains(norm, "sport") || strings.Contains(norm, "cricket") || strings.Contains(norm, "football") || strings.Contains(norm, "racing") || strings.Contains(norm, "tennis")) {
			return true
		}
		if f == "news" && (strings.Contains(norm, "news") || strings.Contains(norm, "khabar") || strings.Contains(norm, "samachar") || strings.Contains(norm, "headline")) {
			return true
		}
		if f == "music" && (strings.Contains(norm, "music") || strings.Contains(norm, "song") || strings.Contains(norm, "gaana") || strings.Contains(norm, "geet")) {
			return true
		}
		if f == "entertainment" && (strings.Contains(norm, "entertain") || strings.Contains(norm, "general") || strings.Contains(norm, "variety") || strings.Contains(norm, "drama")) {
			return true
		}
		if f == "religious" && (strings.Contains(norm, "religio") || strings.Contains(norm, "islam") || strings.Contains(norm, "hindu") || strings.Contains(norm, "christian") || strings.Contains(norm, "quran") || strings.Contains(norm, "peace") || strings.Contains(norm, "madani")) {
			return true
		}
		if f == "series" && (strings.Contains(norm, "series") || strings.Contains(norm, "show") || strings.Contains(norm, "drama")) {
			return true
		}
		if f == "documentary" && (strings.Contains(norm, "doc") || strings.Contains(norm, "history") || strings.Contains(norm, "nature") || strings.Contains(norm, "science") || strings.Contains(norm, "geo")) {
			return true
		}
		if f == "comedy" && (strings.Contains(norm, "comed") || strings.Contains(norm, "humor") || strings.Contains(norm, "funny")) {
			return true
		}
		if strings.Contains(norm, f) {
			return true
		}
	}
	return false
}

func (s *Store) Query(country, category, search string, limit, offset int, onlyOnline bool) ([]*Channel, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var source []*Channel
	if country == "" || country == "all" {
		source = s.allChannels
	} else {
		source = s.countryChannels[strings.ToUpper(country)]
	}

	if len(source) == 0 {
		return []*Channel{}, 0
	}

	var filtered []*Channel

	hasCategory := category != "" && category != "all"
	searchTrim := strings.TrimSpace(strings.ToLower(search))
	searchTerms := strings.Fields(searchTrim)

	for _, ch := range source {
		if onlyOnline && s.health != nil {
			rec := s.health.Get(ch.ID)
			if rec == nil || rec.Status != "online" {
				continue
			}
		}

		if hasCategory && !matchCategory(ch.Categories, category) {
			continue
		}

		if len(searchTerms) > 0 {
			hay := s.getSearchTextLocked(ch)
			matchAll := true
			for _, term := range searchTerms {
				if !strings.Contains(hay, term) {
					matchAll = false
					break
				}
			}
			if !matchAll {
				continue
			}
		}

		filtered = append(filtered, ch)
	}

	total := len(filtered)
	if offset >= total {
		return []*Channel{}, total
	}

	end := offset + limit
	if end > total {
		end = total
	}

	return filtered[offset:end], total
}

func (s *Store) getSearchTextLocked(ch *Channel) string {
	var hay strings.Builder
	hay.WriteString(strings.ToLower(ch.Name))
	hay.WriteByte(' ')
	hay.WriteString(strings.ToLower(ch.Country))
	hay.WriteByte(' ')
	hay.WriteString(strings.ToLower(ch.Network))
	hay.WriteByte(' ')
	hay.WriteString(strings.ToLower(ch.Owner))
	for _, a := range ch.Alt {
		hay.WriteByte(' ')
		hay.WriteString(strings.ToLower(a))
	}
	return hay.String()
}

func (s *Store) Stats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return map[string]interface{}{
		"countries": len(s.countryChannels),
		"channels":  len(s.channelsByID),
	}
}
