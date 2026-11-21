package main

import (
	"encoding/base64"
	"net/url"
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
