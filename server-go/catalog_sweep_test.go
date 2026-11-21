package main

import (
	"testing"
	"time"
)

func TestNextCatalogChannelRoundRobinCoversEveryChannel(t *testing.T) {
	store := NewStore("")
	store.allChannels = []*Channel{
		{ID: "one"},
		{ID: "two"},
		{ID: "three"},
	}
	health := &HealthStore{store: store}

	want := []string{"one", "two", "three", "one", "two"}
	for i, expected := range want {
		ch := health.nextCatalogChannel()
		if ch == nil {
			t.Fatalf("nextCatalogChannel() returned nil at position %d", i)
		}
		if ch.ID != expected {
			t.Fatalf("position %d: got %q, want %q", i, ch.ID, expected)
		}
	}
}

func TestCatalogRecordFreshnessUsesStatusSpecificWindows(t *testing.T) {
	now := time.Now()
	health := &HealthStore{
		status: map[string]*HealthRecord{
			"online":  {ID: "online", Status: "online", TS: now.Add(-10 * time.Minute).UnixMilli()},
			"offline": {ID: "offline", Status: "offline", TS: now.Add(-6 * time.Minute).UnixMilli()},
			"unknown": {ID: "unknown", Status: "unknown", TS: now.Add(-3 * time.Minute).UnixMilli()},
		},
	}

	if !health.catalogRecordIsFresh("online") {
		t.Fatal("10-minute online record should still be fresh")
	}
	if health.catalogRecordIsFresh("offline") {
		t.Fatal("6-minute offline record should be stale")
	}
	if health.catalogRecordIsFresh("unknown") {
		t.Fatal("3-minute unknown record should be stale")
	}
	if health.catalogRecordIsFresh("missing") {
		t.Fatal("missing record must be probed")
	}
}

func TestPlayableProbeBodyValidation(t *testing.T) {
	cases := []struct {
		name        string
		url         string
		contentType string
		body        string
		want        bool
	}{
		{"valid HLS manifest", "https://example.test/live.m3u8", "application/vnd.apple.mpegurl", "#EXTM3U\n#EXT-X-VERSION:3\n", true},
		{"malformed HLS response", "https://example.test/live.m3u8", "application/vnd.apple.mpegurl", "upstream error", false},
		{"HTML block page", "https://example.test/live.m3u8", "text/html", "<html><body>blocked</body></html>", false},
		{"valid DASH manifest", "https://example.test/live.mpd", "application/dash+xml", "<MPD><Period/></MPD>", true},
		{"malformed DASH response", "https://example.test/live.mpd", "application/dash+xml", "not a manifest", false},
		{"non-empty direct media bytes", "https://example.test/live.ts", "video/mp2t", "GOTMEDIA", true},
		{"empty response", "https://example.test/live.ts", "video/mp2t", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isPlayableProbeBody(tc.url, tc.contentType, []byte(tc.body)); got != tc.want {
				t.Fatalf("isPlayableProbeBody() = %v, want %v", got, tc.want)
			}
		})
	}
}
