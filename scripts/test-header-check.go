package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

func testHeaders(name string, withReferer bool) {
	u := "https://news.sky.com/"
	tr := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 8 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second}

	req, _ := http.NewRequestWithContext(context.Background(), "GET", u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Sec-Ch-Ua", `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`)
	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	req.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	if withReferer {
		req.Header.Set("Referer", "https://news.sky.com/")
	}

	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("[%s] FAIL: %v\n", name, err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
	fmt.Printf("[%s] Status: %d, Server: %s, Preview: %q\n", name, resp.StatusCode, resp.Header.Get("Server"), string(body[:min(80, len(body))]))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	testHeaders("WITH Referer", true)
	testHeaders("WITHOUT Referer", false)
}
