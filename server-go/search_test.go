package main

import (
	"context"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestUnwrapRedirectProviders(t *testing.T) {
	destination := "https://example.com/articles?q=vyora"

	bingPayload := base64.RawURLEncoding.EncodeToString([]byte(destination))
	cases := []struct {
		name string
		input string
		want string
	}{
		{
			name: "DuckDuckGo",
			input: "https://duckduckgo.com/l/?uddg=" + url.QueryEscape(destination) + "&rut=abc",
			want: destination,
		},
		{
			name: "Google",
			input: "https://www.google.com/url?q=" + url.QueryEscape(destination) + "&sa=U",
			want: destination,
		},
		{
			name: "Bing first query parameter",
			input: "https://www.bing.com/ck/a?u=a1" + bingPayload + "&ntb=1",
			want: destination,
		},
		{
			name: "Bing later query parameter",
			input: "https://www.bing.com/ck/a?foo=bar&u=a1" + bingPayload + "&ntb=1",
			want: destination,
		},
		{
			name: "Yahoo",
			input: "https://search.yahoo.com/RU=" + url.PathEscape(destination) + "/RK=2",
			want: destination,
		},
		{
			name: "ordinary URL unchanged",
			input: destination,
			want: destination,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := UnwrapRedirect(tc.input); got != tc.want {
				t.Fatalf("UnwrapRedirect() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSuggestURLUsesSelectedProvider(t *testing.T) {
	cases := []struct {
		engine string
		want   string
		ok     bool
	}{
		{"google", "suggestqueries.google.com", true},
		{"", "suggestqueries.google.com", true},
		{"bing", "api.bing.com", true},
		{"duckduckgo", "ac.duckduckgo.com", true},
		{"brave", "", false},
		{"yahoo", "", false},
		{"unknown", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.engine, func(t *testing.T) {
			got, ok := suggestURL(tc.engine, "hello world")
			if ok != tc.ok {
				t.Fatalf("suggestURL supported = %v, want %v", ok, tc.ok)
			}
			if tc.ok && !strings.Contains(got, tc.want) {
				t.Fatalf("suggestURL = %q, want host containing %q", got, tc.want)
			}
			if tc.ok && !strings.Contains(got, "hello+world") {
				t.Fatalf("suggestURL did not encode query: %q", got)
			}
		})
	}
}

func TestParseSearchSuggestArray(t *testing.T) {
	got := parseSearchSuggestArray(`["hello",["hello world"," hello world ","hello tv",""],[],{}]`)
	want := []string{"hello world", "hello tv"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if got := parseSearchSuggestArray(`{"unexpected":"object"}`); len(got) != 0 {
		t.Fatalf("malformed payload returned suggestions: %v", got)
	}
}

func TestParseDuckDuckGoSuggest(t *testing.T) {
	got := parseDuckDuckGoSuggest(`[{"phrase":"vyora tv"},{"phrase":" VYORA TV "},{"phrase":"browser"}]`)
	want := []string{"vyora tv", "browser"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if got := parseDuckDuckGoSuggest(`{"phrase":"not an array"}`); len(got) != 0 {
		t.Fatalf("malformed payload returned suggestions: %v", got)
	}
}

func TestValidatePublicProxyURLBlocksInternalTargets(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1:8080/",
		"http://10.0.0.1/",
		"http://192.168.1.1/",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://localhost/",
		"http://service.local/",
		"http://metadata.google.internal/",
		"file:///etc/passwd",
		"http://user:pass@example.com/",
	}
	for _, raw := range blocked {
		t.Run(raw, func(t *testing.T) {
			u, err := url.Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			if err := validatePublicProxyURL(context.Background(), u); err == nil {
				t.Fatalf("expected unsafe proxy target to be rejected: %s", raw)
			}
		})
	}
}

func TestValidatePublicProxyURLAllowsPublicLiteralIP(t *testing.T) {
	u, err := url.Parse("https://8.8.8.8/dns-query")
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePublicProxyURL(context.Background(), u); err != nil {
		t.Fatalf("public IP should be allowed: %v", err)
	}
}

func TestIsPublicRoutableIPRejectsSpecialUseRanges(t *testing.T) {
	blocked := []string{
		"100.64.0.1", "192.0.2.10", "198.18.0.1", "198.51.100.8",
		"203.0.113.9", "240.0.0.1", "2001:db8::1", "2001:2::1",
		"64:ff9b:1::1", "::ffff:192.168.1.1",
	}
	for _, raw := range blocked {
		if isPublicRoutableIP(net.ParseIP(raw)) {
			t.Errorf("special-use address unexpectedly allowed: %s", raw)
		}
	}
	for _, raw := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !isPublicRoutableIP(net.ParseIP(raw)) {
			t.Errorf("public address unexpectedly blocked: %s", raw)
		}
	}
}

func TestBrowserProxyRedirectPolicyRejectsPrivateRedirect(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:8080/admin", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := browserProxyRedirectPolicy(req, nil); err == nil {
		t.Fatal("expected redirect policy to reject private destination")
	}
}

func TestBrowserProxyRedirectPolicyLimitsRedirectChain(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	via := make([]*http.Request, 12)
	if err := browserProxyRedirectPolicy(req, via); err != http.ErrUseLastResponse {
		t.Fatalf("redirect policy = %v, want ErrUseLastResponse", err)
	}
}
