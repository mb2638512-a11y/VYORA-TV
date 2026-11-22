package main

// Stream represents an individual media stream for a channel.
type Stream struct {
	ID      string `json:"id,omitempty"`
	URL     string `json:"url"`
	Quality string `json:"quality,omitempty"`
	Label   string `json:"label,omitempty"`
	Referer string `json:"referer,omitempty"`
	UA      string `json:"ua,omitempty"`
	HLS     bool   `json:"hls,omitempty"`
}

// Channel represents a television channel entity.
type Channel struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Alt        []string `json:"alt,omitempty"`
	Network    string   `json:"network,omitempty"`
	Owner      string   `json:"owner,omitempty"`
	Categories []string `json:"categories,omitempty"`
	Country    string   `json:"country"`
	Website    string   `json:"website,omitempty"`
	Logo       string   `json:"logo,omitempty"`
	Icon       string   `json:"icon,omitempty"`
	Launched   *string  `json:"launched,omitempty"`
	Closed     *string  `json:"closed,omitempty"`
	Lang       string   `json:"lang,omitempty"`
	Streams    []Stream `json:"streams"`
}

// Country represents country metadata in the catalog index.
type Country struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Flag      string `json:"flag"`
	FlagImg   string `json:"flagImg,omitempty"`
	FlagLocal string `json:"flagLocal,omitempty"`
	Count     int    `json:"count"`
}

// Category represents a channel category in the catalog index.
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Totals represents summary counts.
type Totals struct {
	Countries int `json:"countries"`
	Channels  int `json:"channels"`
	Streams   int `json:"streams"`
	Online    int `json:"online,omitempty"`
}

// BootstrapIndex represents the root metadata payload.
type BootstrapIndex struct {
	GeneratedAt string     `json:"generatedAt"`
	Totals      Totals     `json:"totals"`
	Featured    []string   `json:"featured"`
	Countries   []Country  `json:"countries"`
	Categories  []Category `json:"categories"`
}

// SourceHealthRecord stores recent playback evidence for one source index.
type SourceHealthRecord struct {
	Status         string `json:"status"`
	TS             int64  `json:"ts"`
	MS             int    `json:"ms"`
	SuccessCount   int    `json:"successCount,omitempty"`
	FailureCount   int    `json:"failureCount,omitempty"`
	LastSuccessTS  int64  `json:"lastSuccessTs,omitempty"`
	LastFailureTS  int64  `json:"lastFailureTs,omitempty"`
}

// HealthRecord represents real-time channel and per-source stream status.
type HealthRecord struct {
	ID         string                        `json:"id"`
	Status     string                        `json:"status"` // "online" | "offline" | "unknown"
	TS         int64                         `json:"ts"`
	MS         int                           `json:"ms"`
	Source     string                        `json:"source"`
	BestStream int                           `json:"bestStream"`
	Sources    map[int]SourceHealthRecord    `json:"sources,omitempty"`
}

// HealthStats represents an aggregate summary of channel statuses.
type HealthStats struct {
	Online  int `json:"online"`
	Offline int `json:"offline"`
	Total   int `json:"total"`
	Rate    int `json:"rate,omitempty"`
}
