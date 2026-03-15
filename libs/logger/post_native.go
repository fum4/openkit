//go:build !js

package logger

import (
	"bytes"
	"net/http"
	"time"
)

func postToServer(url string, body []byte) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return
	}
	resp.Body.Close()
}
