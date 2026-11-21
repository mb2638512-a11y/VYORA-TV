package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"
)

func main() {
	urls := []string{
		"https://www.bbc.co.uk/news",
		"https://apnews.com/",
		"https://www.washingtonpost.com/",
		"https://news.sky.com/",
		"https://www.cnn.com/",
		"https://www.foxnews.com/",
		"https://en.wikipedia.org/wiki/Main_Page",
		"https://www.reuters.com/",
	}

	directTr := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 4 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	directClient := &http.Client{Transport: directTr, Timeout: 5 * time.Second}

	proxyU, _ := url.Parse("http://127.0.0.1:8080")
	tunnelTr := &http.Transport{
		Proxy: http.ProxyURL(proxyU),
		DialContext: (&net.Dialer{
			Timeout: 6 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	tunnelClient := &http.Client{Transport: tunnelTr, Timeout: 8 * time.Second}

	fetchSite := func(target string) (*http.Response, string, error) {
		req, _ := http.NewRequestWithContext(context.Background(), "GET", target, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
		req.Header.Set("Sec-Ch-Ua", `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`)
		req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
		req.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
		req.Header.Set("Sec-Fetch-Dest", "document")
		req.Header.Set("Sec-Fetch-Mode", "navigate")
		req.Header.Set("Sec-Fetch-Site", "none")
		req.Header.Set("Sec-Fetch-User", "?1")
		req.Header.Set("Upgrade-Insecure-Requests", "1")

		// 1. Try direct first (fastest)
		resp, err := directClient.Do(req)
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 400 {
			return resp, "direct", nil
		}

		// If direct failed or returned 403 / 5xx, try tunnel!
		if resp != nil {
			resp.Body.Close()
		}

		// Re-create request for tunnel
		req2, _ := http.NewRequestWithContext(context.Background(), "GET", target, nil)
		req2.Header = req.Header.Clone()
		resp2, err2 := tunnelClient.Do(req2)
		if err2 == nil {
			return resp2, "tunnel", nil
		}
		if err != nil {
			return nil, "failed", err
		}
		return nil, "failed", err2
	}

	fmt.Println("=== Testing Dual Direct + Tunnel Fallback ===")
	for _, u := range urls {
		t0 := time.Now()
		resp, via, err := fetchSite(u)
		dt := time.Since(t0)
		if err != nil {
			fmt.Printf("❌ FAIL: %s (%v) -> %v\n", u, dt, err)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		fmt.Printf("✅ PASS: %s via %s (%v) -> Status %d, Bytes: %d\n", u, via, dt, resp.StatusCode, len(body))
	}
}
