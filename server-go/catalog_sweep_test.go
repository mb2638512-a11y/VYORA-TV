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


func TestReportSourcePersistsEvidenceAndOrdersFastHealthyStreams(t *testing.T) {
	health := &HealthStore{status: make(map[string]*HealthRecord)}
	channel := &Channel{ID: "news", Streams: []Stream{
		{ID: "unknown", URL: "https://unknown.example/live.m3u8"},
		{ID: "fast", URL: "https://fast.example/live.m3u8"},
		{ID: "failed", URL: "https://failed.example/live.m3u8"},
	}}

	health.ReportSource(channel.ID, true, 180, 1)
	health.ReportSource(channel.ID, false, 900, 2)

	rec := health.Get(channel.ID)
	if rec == nil || len(rec.Sources) != 2 {
		t.Fatalf("expected two per-source records, got %#v", rec)
	}
	if rec.Sources[1].Status != "online" || rec.Sources[1].SuccessCount != 1 {
		t.Fatalf("successful source evidence not recorded: %#v", rec.Sources[1])
	}
	if rec.Sources[2].Status != "offline" || rec.Sources[2].FailureCount != 1 {
		t.Fatalf("failed source evidence not recorded: %#v", rec.Sources[2])
	}
	if rec.Status != "online" || rec.BestStream != 1 {
		t.Fatalf("one failed alternate incorrectly poisoned channel health: status=%q best=%d", rec.Status, rec.BestStream)
	}

	ordered, original := health.OrderStreams(channel)
	if len(ordered) != 3 || len(original) != 3 {
		t.Fatalf("unexpected ordered result lengths: streams=%d indexes=%d", len(ordered), len(original))
	}
	if original[0] != 1 || original[2] != 2 {
		t.Fatalf("expected fast source first and recently failed source last, got %v", original)
	}
}

func TestHealthGetReturnsIndependentSourceMap(t *testing.T) {
	health := &HealthStore{status: map[string]*HealthRecord{
		"channel": {ID: "channel", Sources: map[int]SourceHealthRecord{
			0: {Status: "online", MS: 120},
		}},
	}}
	copyRec := health.Get("channel")
	copyRec.Sources[0] = SourceHealthRecord{Status: "offline"}
	stored := health.Get("channel")
	if stored.Sources[0].Status != "online" {
		t.Fatalf("mutating returned health snapshot changed stored state: %#v", stored.Sources[0])
	}
}


func TestMarkChannelOfflineRequiresExplicitFullExhaustion(t *testing.T) {
	health := &HealthStore{status: make(map[string]*HealthRecord)}
	health.ReportSource("sports", true, 240, 0)
	health.ReportSource("sports", false, 900, 1)

	before := health.Get("sports")
	if before.Status != "online" {
		t.Fatalf("one failed alternate must not mark channel offline: %#v", before)
	}

	health.MarkChannelOffline("sports", 12000)
	after := health.Get("sports")
	if after.Status != "offline" || after.Source != "playback-exhausted" {
		t.Fatalf("explicit exhaustion should mark channel offline: %#v", after)
	}
	if len(after.Sources) != 2 {
		t.Fatalf("channel-level exhaustion must preserve per-source evidence: %#v", after.Sources)
	}
}
