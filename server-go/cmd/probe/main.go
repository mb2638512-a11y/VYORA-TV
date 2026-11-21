package main

import (
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

func probe(name, url string) {
	const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
	c := &http.Client{
		Timeout: 25 * time.Second,
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: (&net.Dialer{Timeout: 8 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			DisableCompression: false,
		},
	}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", chromeUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	t0 := time.Now()
	resp, err := c.Do(req)
	if err != nil {
		fmt.Printf("%-14s ERR %v\n", name, err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 12*1024*1024))
	s := string(body)
	fmt.Printf("%-14s %d  %db  %dms  enc=%q  ct=%q\n", name, resp.StatusCode, len(body), time.Since(t0).Milliseconds(),
		resp.Header.Get("Content-Encoding"), resp.Header.Get("Content-Type"))
	outDir := `E:\Vyora TV\scripts\_engine_html`
	_ = os.MkdirAll(outDir, 0o755)
	os.WriteFile(fmt.Sprintf("%s\\go_%s.html", outDir, name), body, 0o644)

	switch name {
	case "ddg":
		fmt.Printf("    result__a=%d  result__s=%d  'challenge'=%v\n",
			strings.Count(s, `class="result__a"`), strings.Count(s, `class="result__s"`),
			strings.Contains(strings.ToLower(s), "anomaly") || strings.Contains(strings.ToLower(s), "challenge"))
	case "brave":
		fmt.Printf("    snippet=%d  result-header=%d\n", strings.Count(s, `class="snippet"`), strings.Count(s, `result-header`))
	case "bing":
		fmt.Printf("    b_algo=%d\n", strings.Count(s, `class="b_algo"`))
	}
}

func main() {
	probe("ddg", "https://html.duckduckgo.com/html/?q=youtube")
	time.Sleep(2 * time.Second)
	probe("brave", "https://search.brave.com/search?q=youtube")
	time.Sleep(2 * time.Second)
	probe("bing", "https://www.bing.com/search?q=youtube&setmkt=en-US&cc=US")
	time.Sleep(2 * time.Second)
	probe("google", "https://www.google.com/search?q=youtube&igu=1&num=10")
}
