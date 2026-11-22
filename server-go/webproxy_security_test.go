package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"testing"
)

func TestIsPublicRoutableIP(t *testing.T) {
	tests := []struct {
		name string
		ip   string
		want bool
	}{
		{name: "public IPv4", ip: "1.1.1.1", want: true},
		{name: "public IPv6", ip: "2606:4700:4700::1111", want: true},
		{name: "loopback IPv4", ip: "127.0.0.1"},
		{name: "private 10/8", ip: "10.1.2.3"},
		{name: "private 172.16/12", ip: "172.16.0.1"},
		{name: "private 192.168/16", ip: "192.168.1.1"},
		{name: "link local metadata", ip: "169.254.169.254"},
		{name: "unspecified IPv4", ip: "0.0.0.0"},
		{name: "multicast IPv4", ip: "224.0.0.1"},
		{name: "documentation IPv4", ip: "192.0.2.1"},
		{name: "benchmark IPv4", ip: "198.18.0.1"},
		{name: "loopback IPv6", ip: "::1"},
		{name: "unique local IPv6", ip: "fd00::1"},
		{name: "link local IPv6", ip: "fe80::1"},
		{name: "multicast IPv6", ip: "ff02::1"},
		{name: "unspecified IPv6", ip: "::"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isPublicRoutableIP(net.ParseIP(tt.ip)); got != tt.want {
				t.Fatalf("isPublicRoutableIP(%q) = %v, want %v", tt.ip, got, tt.want)
			}
		})
	}
	if isPublicRoutableIP(nil) {
		t.Fatal("nil IP must not be considered public")
	}
}

func TestValidatePublicProxyURLRejectsUnsafeTargets(t *testing.T) {
	tests := []string{
		"http://localhost/",
		"https://sub.localhost/",
		"https://service.local/",
		"https://service.internal/",
		"https://metadata.google.internal/",
		"https://127.0.0.1/",
		"https://10.0.0.1/",
		"https://192.168.1.1/",
		"https://169.254.169.254/",
		"https://[::1]/",
		"https://[fd00::1]/",
		"https://user:password@example.com/",
		"file:///etc/passwd",
		"ftp://example.com/",
	}
	for _, raw := range tests {
		t.Run(raw, func(t *testing.T) {
			target, err := url.Parse(raw)
			if err != nil {
				t.Fatalf("url.Parse(%q): %v", raw, err)
			}
			if err := validatePublicProxyURL(context.Background(), target); !errors.Is(err, ErrUnsafeProxyTarget) {
				t.Fatalf("validatePublicProxyURL(%q) = %v, want ErrUnsafeProxyTarget", raw, err)
			}
		})
	}
}

func TestBrowserProxyRedirectPolicyStopsLongRedirectChains(t *testing.T) {
	target, err := url.Parse("http://127.0.0.1/")
	if err != nil {
		t.Fatal(err)
	}
	req := &http.Request{URL: target}
	via := make([]*http.Request, 12)
	if err := browserProxyRedirectPolicy(req, via); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatalf("redirect policy with 12 prior hops = %v, want ErrUseLastResponse", err)
	}
	if err := browserProxyRedirectPolicy(req, nil); !errors.Is(err, ErrUnsafeProxyTarget) {
		t.Fatalf("redirect policy with unsafe target = %v, want ErrUnsafeProxyTarget", err)
	}
}
