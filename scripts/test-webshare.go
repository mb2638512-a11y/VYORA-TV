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
	}

	proxyStr := "http://lugwkqld:ovv66w4p4wq0@31.59.20.176:6754"
	proxyU, _ := url.Parse(proxyStr)
	tr := &http.Transport{
		Proxy: http.ProxyURL(proxyU),
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   15 * time.Second,
	}

	fmt.Println("Testing Webshare Proxy:")
	for _, u := range urls {
		req, _ := http.NewRequestWithContext(context.Background(), "GET", u, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

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
}
