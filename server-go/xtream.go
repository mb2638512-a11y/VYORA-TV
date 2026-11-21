package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

type XtreamAuthResponse struct {
	UserInfo   map[string]interface{} `json:"user_info"`
	ServerInfo map[string]interface{} `json:"server_info"`
}

type XtreamCategory struct {
	CategoryID   string      `json:"category_id"`
	CategoryName string      `json:"category_name"`
	ParentID     interface{} `json:"parent_id"`
}

type XtreamStreamItem struct {
	Num          int         `json:"num"`
	Name         string      `json:"name"`
	StreamType   string      `json:"stream_type"`
	StreamID     interface{} `json:"stream_id"`
	StreamIcon   string      `json:"stream_icon"`
	EPGChannelID string      `json:"epg_channel_id"`
	CategoryID   interface{} `json:"category_id"`
}

func handleXtreamAuth(w http.ResponseWriter, r *http.Request, client *http.Client) {
	serverURL := strings.TrimRight(r.URL.Query().Get("server"), "/")
	username := r.URL.Query().Get("username")
	password := r.URL.Query().Get("password")

	if serverURL == "" || username == "" || password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "server, username, and password are required"})
		return
	}

	targetURL := fmt.Sprintf("%s/player_api.php?username=%s&password=%s",
		serverURL, url.QueryEscape(username), url.QueryEscape(password))

	req, err := http.NewRequestWithContext(r.Context(), "GET", targetURL, nil)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("User-Agent", "IPTVSmarters/1.0.0")

	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to reach Xtream server: %v", err)})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Failed to read response"})
		return
	}

	var authRes XtreamAuthResponse
	if err := json.Unmarshal(body, &authRes); err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"ok":    false,
			"error": "Invalid credentials or Xtream server response",
		})
		return
	}

	authStatus, _ := authRes.UserInfo["status"].(string)
	isAuth := authStatus == "Active"
	if authVal, ok := authRes.UserInfo["auth"].(float64); ok && authVal == 1 {
		isAuth = true
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":          isAuth,
		"user_info":   authRes.UserInfo,
		"server_info": authRes.ServerInfo,
	})
}

func handleXtreamCategories(w http.ResponseWriter, r *http.Request, client *http.Client) {
	serverURL := strings.TrimRight(r.URL.Query().Get("server"), "/")
	username := r.URL.Query().Get("username")
	password := r.URL.Query().Get("password")

	targetURL := fmt.Sprintf("%s/player_api.php?username=%s&password=%s&action=get_live_categories",
		serverURL, url.QueryEscape(username), url.QueryEscape(password))

	req, err := http.NewRequestWithContext(r.Context(), "GET", targetURL, nil)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("User-Agent", "IPTVSmarters/1.0.0")

	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	var categories []XtreamCategory
	if err := json.Unmarshal(body, &categories); err != nil {
		writeJSON(w, http.StatusOK, []XtreamCategory{})
		return
	}

	writeJSON(w, http.StatusOK, categories)
}

func handleXtreamStreams(w http.ResponseWriter, r *http.Request, client *http.Client) {
	serverURL := strings.TrimRight(r.URL.Query().Get("server"), "/")
	username := r.URL.Query().Get("username")
	password := r.URL.Query().Get("password")
	catID := r.URL.Query().Get("category_id")

	action := "get_live_streams"
	targetURL := fmt.Sprintf("%s/player_api.php?username=%s&password=%s&action=%s",
		serverURL, url.QueryEscape(username), url.QueryEscape(password), action)
	if catID != "" && catID != "all" {
		targetURL += fmt.Sprintf("&category_id=%s", url.QueryEscape(catID))
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", targetURL, nil)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("User-Agent", "IPTVSmarters/1.0.0")

	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	var rawItems []XtreamStreamItem
	if err := json.Unmarshal(body, &rawItems); err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"channels": []Channel{}, "total": 0})
		return
	}

	var channels []Channel
	for _, item := range rawItems {
		sid := fmt.Sprintf("%v", item.StreamID)
		if sid == "" || sid == "<nil>" {
			continue
		}
		streamURL := fmt.Sprintf("%s/live/%s/%s/%s.m3u8", serverURL, username, password, sid)
		catStr := fmt.Sprintf("%v", item.CategoryID)
		if catStr == "<nil>" || catStr == "" {
			catStr = "general"
		}

		channels = append(channels, Channel{
			ID:         fmt.Sprintf("xtream-%s", sid),
			Name:       item.Name,
			Country:    "XTREAM",
			Logo:       item.StreamIcon,
			Icon:       item.StreamIcon,
			Categories: []string{catStr},
			Streams: []Stream{
				{
					ID:      fmt.Sprintf("xtream-%s-0", sid),
					URL:     streamURL,
					Quality: "1080p",
					Label:   "Xtream Live HD",
					HLS:     true,
				},
			},
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total":    len(channels),
		"channels": channels,
	})
}

var m3uIdRegex = regexp.MustCompile(`tvg-id="([^"]+)"`)
var m3uLogoRegex = regexp.MustCompile(`tvg-logo="([^"]+)"`)
var m3uGroupRegex = regexp.MustCompile(`group-title="([^"]+)"`)

func handleM3UImport(w http.ResponseWriter, r *http.Request, client *http.Client) {
	playlistURL := r.URL.Query().Get("url")
	if playlistURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url parameter is required"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", playlistURL, nil)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VyoraTV/1.0.0")

	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to fetch M3U: %v", err)})
		return
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(io.LimitReader(resp.Body, 20*1024*1024))
	var channels []Channel

	var currentName, currentLogo, currentGroup, currentID string

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "#EXTINF") {
			currentID = ""
			currentLogo = ""
			currentGroup = "general"

			if m := m3uIdRegex.FindStringSubmatch(line); len(m) > 1 {
				currentID = m[1]
			}
			if m := m3uLogoRegex.FindStringSubmatch(line); len(m) > 1 {
				currentLogo = m[1]
			}
			if m := m3uGroupRegex.FindStringSubmatch(line); len(m) > 1 {
				currentGroup = strings.ToLower(strings.TrimSpace(m[1]))
			}

			parts := strings.Split(line, ",")
			if len(parts) > 1 {
				currentName = strings.TrimSpace(parts[len(parts)-1])
			} else {
				currentName = "Channel " + fmt.Sprintf("%d", len(channels)+1)
			}
			continue
		}

		if strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://") {
			if currentName == "" {
				currentName = fmt.Sprintf("Stream %d", len(channels)+1)
			}
			if currentID == "" {
				currentID = fmt.Sprintf("custom-%d", len(channels)+1)
			}

			channels = append(channels, Channel{
				ID:         currentID,
				Name:       currentName,
				Country:    "CUSTOM",
				Logo:       currentLogo,
				Icon:       currentLogo,
				Categories: []string{currentGroup},
				Streams: []Stream{
					{
						ID:      fmt.Sprintf("%s-0", currentID),
						URL:     line,
						Quality: "720p",
						Label:   "Custom Live",
						HLS:     strings.Contains(line, ".m3u8"),
					},
				},
			})

			currentName = ""
			currentLogo = ""
			currentID = ""
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"total":    len(channels),
		"channels": channels,
	})
}
