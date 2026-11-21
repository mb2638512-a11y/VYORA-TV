package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// GO BROWSER CORE — HTTP SURFACE
//
//   GET    /api/suggest?q=<query>            -> Google autocomplete
//   GET    /api/browser/bookmarks            -> bookmark CRUD
//   GET    /api/browser/history              -> browsing history
//   GET    /api/browser/settings             -> browser settings
//   POST   /api/browser/clear                -> clear browsing data
//
// There is deliberately NO server-side "search results" endpoint any more.
// Search is rendered by the browser engine itself (Google's own page, with
// real JavaScript), because Google answers every plain HTTP client with a
// JavaScript-only shell that contains no result markup. Scraping that shell
// is what made the old engine selector silently serve DuckDuckGo under every
// engine's name.
// ============================================================================

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

type BrowserAPI struct {
	suggest *SuggestCache
}

// NewBrowserAPI builds the browser-core HTTP surface.
func NewBrowserAPI() *BrowserAPI {
	return &BrowserAPI{suggest: NewSuggestCache()}
}

// HandleSuggest serves GET /api/suggest — Google's autocomplete.
func (a *BrowserAPI) HandleSuggest(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	suggestions := a.suggest.Suggestions(r, q)
	if suggestions == nil {
		suggestions = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"query":       q,
		"suggestions": suggestions,
	})
}

// ---------------------------------------------------------------------------
// Bookmarks / history / settings persistence
// ---------------------------------------------------------------------------

type BookmarkRecord struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Favicon   string `json:"favicon,omitempty"`
	Folder    string `json:"folder,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

type BrowserStore struct {
	mu        sync.RWMutex
	file      string
	bookmarks []BookmarkRecord
	history   []BookmarkRecord
	settings  map[string]string
}

func NewBrowserStore(file string) *BrowserStore {
	s := &BrowserStore{
		file:      file,
		bookmarks: []BookmarkRecord{},
		history:   []BookmarkRecord{},
		settings:  map[string]string{},
	}
	s.load()
	return s
}

func (s *BrowserStore) load() {
	raw, err := os.ReadFile(s.file)
	if err != nil {
		return
	}
	var data struct {
		Bookmarks []BookmarkRecord  `json:"bookmarks"`
		History   []BookmarkRecord  `json:"history"`
		Settings  map[string]string `json:"settings"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if data.Bookmarks != nil {
		s.bookmarks = data.Bookmarks
	}
	if data.History != nil {
		s.history = data.History
	}
	if data.Settings != nil {
		s.settings = data.Settings
	}
}

func (s *BrowserStore) save() {
	s.mu.RLock()
	data := struct {
		Bookmarks []BookmarkRecord  `json:"bookmarks"`
		History   []BookmarkRecord  `json:"history"`
		Settings  map[string]string `json:"settings"`
	}{s.bookmarks, s.history, s.settings}
	s.mu.RUnlock()
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.file), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(s.file, raw, 0o644)
}

// HandleBookmarks serves GET/POST/DELETE /api/browser/bookmarks
func (s *BrowserStore) HandleBookmarks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		out := append([]BookmarkRecord{}, s.bookmarks...)
		s.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]interface{}{"bookmarks": out})
	case http.MethodPost:
		var b BookmarkRecord
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		if b.URL == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing url"})
			return
		}
		if b.ID == "" {
			b.ID = "bm-" + strconv.FormatInt(time.Now().UnixNano(), 36)
		}
		if b.CreatedAt == 0 {
			b.CreatedAt = time.Now().UnixMilli()
		}
		s.mu.Lock()
		filtered := s.bookmarks[:0]
		for _, existing := range s.bookmarks {
			if existing.URL != b.URL {
				filtered = append(filtered, existing)
			}
		}
		s.bookmarks = append([]BookmarkRecord{b}, filtered...)
		s.mu.Unlock()
		s.save()
		writeJSON(w, http.StatusOK, map[string]interface{}{"bookmark": b})
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		s.mu.Lock()
		filtered := s.bookmarks[:0]
		for _, existing := range s.bookmarks {
			if existing.ID != id {
				filtered = append(filtered, existing)
			}
		}
		s.bookmarks = filtered
		s.mu.Unlock()
		s.save()
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

// HandleBrowserHistory serves GET /api/browser/history
func (s *BrowserStore) HandleBrowserHistory(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	out := append([]BookmarkRecord{}, s.history...)
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]interface{}{"history": out})
}

// HandleBrowserSettings serves GET/POST /api/browser/settings
func (s *BrowserStore) HandleBrowserSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		out := map[string]string{}
		for k, v := range s.settings {
			out[k] = v
		}
		s.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]interface{}{"settings": out})
	case http.MethodPost:
		var incoming map[string]string
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		s.mu.Lock()
		for k, v := range incoming {
			s.settings[k] = v
		}
		s.mu.Unlock()
		s.save()
		writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

// HandleClearData serves POST /api/browser/clear
func (s *BrowserStore) HandleClearData(w http.ResponseWriter, r *http.Request) {
	what := r.URL.Query().Get("what") // bookmarks | history | all
	s.mu.Lock()
	switch what {
	case "bookmarks":
		s.bookmarks = []BookmarkRecord{}
	case "history":
		s.history = []BookmarkRecord{}
	default:
		s.bookmarks = []BookmarkRecord{}
		s.history = []BookmarkRecord{}
	}
	s.mu.Unlock()
	s.save()
	writeJSON(w, http.StatusOK, map[string]string{"status": "cleared", "what": what})
}

// RegisterBrowserRoutes mounts the browser-core endpoints on the mux.
//
// NOTE: the suggestion route is "/api/suggest", NOT "/api/search".
// "/api/search" is the IPTV *channel* search route (main.go) and the frontend
// channel search already depends on its "{channels:[...]}" shape. Registering
// the browser search on the same path made ServeMux route to the more specific
// pattern and silently broke TV channel search.
func RegisterBrowserRoutes(mux *http.ServeMux, api *BrowserAPI, store *BrowserStore) {
	mux.HandleFunc("/api/suggest", api.HandleSuggest)
	mux.HandleFunc("/api/browser/bookmarks", store.HandleBookmarks)
	mux.HandleFunc("/api/browser/history", store.HandleBrowserHistory)
	mux.HandleFunc("/api/browser/settings", store.HandleBrowserSettings)
	mux.HandleFunc("/api/browser/clear", store.HandleClearData)
}
