package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type DownloadItem struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	URL         string     `json:"url"`
	Type        string     `json:"type"` // "apk", "movie", "media", "file"
	SizeBytes   int64      `json:"sizeBytes"`
	Downloaded  int64      `json:"downloaded"`
	Progress    int        `json:"progress"` // 0-100
	Status      string     `json:"status"`   // "downloading", "completed", "failed"
	Speed       string     `json:"speed"`    // e.g. "2.4 MB/s"
	FileName    string     `json:"fileName"`
	FilePath    string     `json:"filePath"`
	DownloadURL string     `json:"downloadUrl"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	ErrorMsg    string     `json:"errorMsg,omitempty"`
}

type DownloadManager struct {
	dir      string
	metaFile string
	items    map[string]*DownloadItem
	mu       sync.RWMutex
	client   *http.Client
}

var globalDownloads *DownloadManager

func InitDownloadManager(dataDir string) *DownloadManager {
	dlDir := filepath.Join(dataDir, "downloads")
	_ = os.MkdirAll(dlDir, 0755)

	dm := &DownloadManager{
		dir:      dlDir,
		metaFile: filepath.Join(dlDir, "metadata.json"),
		items:    make(map[string]*DownloadItem),
		client: &http.Client{
			Timeout: 0, // No overall timeout for large file downloads
			Transport: &http.Transport{
				MaxIdleConns:        100,
				IdleConnTimeout:     90 * time.Second,
				TLSHandshakeTimeout: 10 * time.Second,
			},
		},
	}

	dm.loadMetadata()
	dm.scanExistingFiles()

	globalDownloads = dm
	return dm
}

func (dm *DownloadManager) loadMetadata() {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	data, err := os.ReadFile(dm.metaFile)
	if err != nil {
		return
	}

	var list []*DownloadItem
	if err := json.Unmarshal(data, &list); err == nil {
		for _, item := range list {
			// If was downloading when server stopped, mark failed/paused
			if item.Status == "downloading" {
				item.Status = "failed"
				item.ErrorMsg = "interrupted by server restart"
			}
			item.DownloadURL = "/api/downloads/file?id=" + item.ID
			dm.items[item.ID] = item
		}
	}
}

func (dm *DownloadManager) saveMetadata() {
	dm.mu.RLock()
	list := make([]*DownloadItem, 0, len(dm.items))
	for _, item := range dm.items {
		list = append(list, item)
	}
	dm.mu.RUnlock()

	data, err := json.MarshalIndent(list, "", "  ")
	if err == nil {
		_ = os.WriteFile(dm.metaFile, data, 0644)
	}
}

// scanExistingFiles imports any pre-existing movie or APK placed into the downloads folder
func (dm *DownloadManager) scanExistingFiles() {
	entries, err := os.ReadDir(dm.dir)
	if err != nil {
		return
	}

	dm.mu.Lock()
	defer dm.mu.Unlock()

	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == "metadata.json" {
			continue
		}
		// Check if already in items
		found := false
		for _, it := range dm.items {
			if it.FileName == entry.Name() {
				found = true
				break
			}
		}
		if !found {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			id := fmt.Sprintf("dl-%d", time.Now().UnixNano())
			name := entry.Name()
			itemType := detectItemType(name)
			now := info.ModTime()

			item := &DownloadItem{
				ID:          id,
				Name:        name,
				FileName:    name,
				FilePath:    filepath.Join(dm.dir, name),
				Type:        itemType,
				SizeBytes:   info.Size(),
				Downloaded:  info.Size(),
				Progress:    100,
				Status:      "completed",
				DownloadURL: "/api/downloads/file?id=" + id,
				CreatedAt:   now,
				CompletedAt: &now,
			}
			dm.items[id] = item
		}
	}
}

func detectItemType(filenameOrURL string) string {
	lower := strings.ToLower(filenameOrURL)
	if strings.HasSuffix(lower, ".apk") {
		return "apk"
	}
	if strings.HasSuffix(lower, ".mp4") || strings.HasSuffix(lower, ".mkv") || strings.HasSuffix(lower, ".avi") ||
		strings.HasSuffix(lower, ".mov") || strings.HasSuffix(lower, ".webm") || strings.HasSuffix(lower, ".ts") {
		return "movie"
	}
	if strings.HasSuffix(lower, ".mp3") || strings.HasSuffix(lower, ".aac") || strings.HasSuffix(lower, ".m4a") {
		return "audio"
	}
	return "file"
}

func cleanFileName(name string) string {
	// Remove invalid filesystem chars
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	clean := replacer.Replace(name)
	if len(clean) > 80 {
		ext := filepath.Ext(clean)
		clean = clean[:70] + ext
	}
	return clean
}

func (dm *DownloadManager) StartDownload(targetURL, customName, forceType string) (*DownloadItem, error) {
	targetURL = strings.TrimSpace(targetURL)
	if targetURL == "" {
		return nil, fmt.Errorf("empty url")
	}

	fileName := cleanFileName(customName)
	if fileName == "" {
		// Extract from URL
		parts := strings.Split(targetURL, "/")
		last := parts[len(parts)-1]
		if idx := strings.Index(last, "?"); idx != -1 {
			last = last[:idx]
		}
		fileName = cleanFileName(last)
	}

	itemType := forceType
	if itemType == "" {
		itemType = detectItemType(fileName)
		if itemType == "file" {
			itemType = detectItemType(targetURL)
		}
	}

	// Ensure default extension if missing
	if itemType == "apk" && !strings.HasSuffix(strings.ToLower(fileName), ".apk") {
		fileName += ".apk"
	} else if itemType == "movie" && filepath.Ext(fileName) == "" {
		fileName += ".mp4"
	}

	id := fmt.Sprintf("dl-%d", time.Now().UnixMilli())
	localPath := filepath.Join(dm.dir, fmt.Sprintf("%s-%s", id, fileName))

	item := &DownloadItem{
		ID:          id,
		Name:        fileName,
		URL:         targetURL,
		Type:        itemType,
		SizeBytes:   0,
		Downloaded:  0,
		Progress:    0,
		Status:      "downloading",
		Speed:       "0 KB/s",
		FileName:    filepath.Base(localPath),
		FilePath:    localPath,
		DownloadURL: "/api/downloads/file?id=" + id,
		CreatedAt:   time.Now(),
	}

	dm.mu.Lock()
	dm.items[id] = item
	dm.mu.Unlock()
	dm.saveMetadata()

	// Launch download in background goroutine
	go dm.downloadWorker(item)

	return item, nil
}

func (dm *DownloadManager) downloadWorker(item *DownloadItem) {
	req, err := http.NewRequest("GET", item.URL, nil)
	if err != nil {
		dm.failItem(item.ID, err.Error())
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

	resp, err := dm.client.Do(req)
	if err != nil {
		dm.failItem(item.ID, err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		dm.failItem(item.ID, fmt.Sprintf("HTTP error %d", resp.StatusCode))
		return
	}

	out, err := os.Create(item.FilePath)
	if err != nil {
		dm.failItem(item.ID, err.Error())
		return
	}
	defer out.Close()

	item.SizeBytes = resp.ContentLength
	dm.saveMetadata()

	buffer := make([]byte, 64*1024) // 64KB buffer
	var downloaded int64
	startTime := time.Now()
	lastReport := time.Now()
	var lastBytes int64

	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			_, writeErr := out.Write(buffer[:n])
			if writeErr != nil {
				dm.failItem(item.ID, writeErr.Error())
				return
			}
			downloaded += int64(n)

			// Progress reporting every 400ms
			if time.Since(lastReport) >= 400*time.Millisecond {
				elapsedSec := time.Since(lastReport).Seconds()
				if elapsedSec > 0 {
					speedBps := float64(downloaded-lastBytes) / elapsedSec
					if speedBps > 1024*1024 {
						item.Speed = fmt.Sprintf("%.1f MB/s", speedBps/(1024*1024))
					} else {
						item.Speed = fmt.Sprintf("%.0f KB/s", speedBps/1024)
					}
				}
				lastBytes = downloaded
				lastReport = time.Now()

				item.Downloaded = downloaded
				if item.SizeBytes > 0 {
					item.Progress = int((float64(downloaded) / float64(item.SizeBytes)) * 100)
				}
			}
		}

		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			dm.failItem(item.ID, readErr.Error())
			return
		}
	}

	now := time.Now()
	totalSec := now.Sub(startTime).Seconds()
	avgSpeed := "0 KB/s"
	if totalSec > 0 {
		bps := float64(downloaded) / totalSec
		if bps > 1024*1024 {
			avgSpeed = fmt.Sprintf("%.1f MB/s", bps/(1024*1024))
		} else {
			avgSpeed = fmt.Sprintf("%.0f KB/s", bps/1024)
		}
	}

	dm.mu.Lock()
	item.Downloaded = downloaded
	if item.SizeBytes <= 0 {
		item.SizeBytes = downloaded
	}
	item.Progress = 100
	item.Status = "completed"
	item.Speed = avgSpeed
	item.CompletedAt = &now
	dm.mu.Unlock()

	dm.saveMetadata()
	log.Printf("[DOWNLOAD] Completed: %s (%d bytes) in %.1fs", item.Name, downloaded, totalSec)
}

func (dm *DownloadManager) failItem(id, errMsg string) {
	dm.mu.Lock()
	if it, ok := dm.items[id]; ok {
		it.Status = "failed"
		it.ErrorMsg = errMsg
		it.Speed = "0 KB/s"
	}
	dm.mu.Unlock()
	dm.saveMetadata()
	log.Printf("[DOWNLOAD] Failed item %s: %s", id, errMsg)
}

func (dm *DownloadManager) List() []*DownloadItem {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	list := make([]*DownloadItem, 0, len(dm.items))
	for _, it := range dm.items {
		list = append(list, it)
	}
	return list
}

func (dm *DownloadManager) Delete(id string) bool {
	dm.mu.Lock()
	it, ok := dm.items[id]
	if ok {
		delete(dm.items, id)
	}
	dm.mu.Unlock()

	if ok && it != nil {
		_ = os.Remove(it.FilePath)
		dm.saveMetadata()
		return true
	}
	return false
}

func (dm *DownloadManager) HandleList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	items := dm.List()
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":    true,
		"items": items,
		"count": len(items),
	})
}

func (dm *DownloadManager) HandleStart(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	q := r.URL.Query()
	targetURL := q.Get("url")
	if targetURL == "" && r.Method == "POST" {
		// Check JSON body
		var body struct {
			URL  string `json:"url"`
			Name string `json:"name"`
			Type string `json:"type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
			targetURL = body.URL
			if body.Name != "" {
				q.Set("name", body.Name)
			}
			if body.Type != "" {
				q.Set("type", body.Type)
			}
		}
	}

	if targetURL == "" {
		http.Error(w, `{"error":"missing url"}`, http.StatusBadRequest)
		return
	}

	item, err := dm.StartDownload(targetURL, q.Get("name"), q.Get("type"))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":   true,
		"item": item,
	})
}

func (dm *DownloadManager) HandleDelete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"missing id"}`, http.StatusBadRequest)
		return
	}

	ok := dm.Delete(id)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      ok,
		"deleted": id,
	})
}

func (dm *DownloadManager) HandleServeFile(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	var targetItem *DownloadItem

	dm.mu.RLock()
	if id != "" {
		targetItem = dm.items[id]
	}
	dm.mu.RUnlock()

	if targetItem == nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	f, err := os.Open(targetItem.FilePath)
	if err != nil {
		http.Error(w, "File not available on disk", http.StatusNotFound)
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		http.Error(w, "File stat error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type")

	// Set content type
	if targetItem.Type == "apk" {
		w.Header().Set("Content-Type", "application/vnd.android.package-archive")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, targetItem.Name))
	} else if targetItem.Type == "movie" {
		w.Header().Set("Content-Type", "video/mp4")
	}

	// ServeContent handles HTTP Range requests for video seeking and paused downloads!
	http.ServeContent(w, r, targetItem.Name, stat.ModTime(), f)
}
