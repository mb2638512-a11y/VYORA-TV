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
