package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

func main() {
	urls := []string{
		"https://www.bbc.co.uk/news",
		"https://apnews.com/",
		"https://www.washingtonpost.com/",
		"https://news.sky.com/",
	}

	fmt.Println("HTTP_PROXY env:", os.Getenv("HTTP_PROXY"))
	fmt.Println("HTTPS_PROXY env:", os.Getenv("HTTPS_PROXY"))

	// Test with ProxyFromEnvironment
	tr := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   15 * time.Second,
	}

	for _, u := range urls {
		req, _ := http.NewRequestWithContext(context.Background(), "GET", u, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")

		t0 := time.Now()
		resp, err := client.Do(req)
		dt := time.Since(t0)
		if err != nil {
			fmt.Printf("FAIL: %s (%v) -> %v\n", u, dt, err)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		fmt.Printf("PASS: %s (%v) -> Status %d, Bytes: %d\n", u, dt, resp.StatusCode, len(body))
	}

	// Also test with explicit 127.0.0.1:8080 proxy
	proxyU, _ := url.Parse("http://127.0.0.1:8080")
	tr8080 := &http.Transport{
		Proxy: http.ProxyURL(proxyU),
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
	}
	client8080 := &http.Client{
		Transport: tr8080,
		Timeout:   15 * time.Second,
	}

	fmt.Println("\nTesting with explicit http://127.0.0.1:8080 proxy:")
	for _, u := range urls {
		req, _ := http.NewRequestWithContext(context.Background(), "GET", u, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

		t0 := time.Now()
		resp, err := client8080.Do(req)
		dt := time.Since(t0)
		if err != nil {
			fmt.Printf("FAIL: %s (%v) -> %v\n", u, dt, err)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		fmt.Printf("PASS: %s (%v) -> Status %d, Bytes: %d\n", u, dt, resp.StatusCode, len(body))
	}
}
