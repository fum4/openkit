package logger

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

const (
	sinkFlushInterval = time.Second
	sinkMaxBuffer     = 50
)

var (
	sinkURL         string
	sinkProjectName string
	sinkBuffer      []sinkEntry
	sinkMu          sync.Mutex
	sinkTicker      *time.Ticker
	sinkDone        chan struct{}
)

type sinkEntry struct {
	Timestamp string         `json:"timestamp"`
	System    string         `json:"system"`
	Subsystem string         `json:"subsystem"`
	Level     string         `json:"level"`
	Message   string         `json:"message"`
	Domain    string         `json:"domain,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type sinkPayload struct {
	Entries []sinkEntry `json:"entries"`
}

// SetSink configures the logger to POST entries to a server endpoint.
// All log calls from all Logger instances will buffer entries and flush
// them periodically to {serverUrl}/api/client-logs.
func SetSink(serverUrl, projectName string) {
	sinkMu.Lock()
	defer sinkMu.Unlock()

	if sinkDone != nil {
		close(sinkDone)
		sinkDone = nil
	}
	if sinkTicker != nil {
		sinkTicker.Stop()
		sinkTicker = nil
	}

	sinkURL = strings.TrimRight(serverUrl, "/")
	sinkProjectName = projectName
	sinkBuffer = nil

	if sinkURL == "" {
		return
	}

	sinkDone = make(chan struct{})
	sinkTicker = time.NewTicker(sinkFlushInterval)

	go func() {
		for {
			select {
			case <-sinkTicker.C:
				doFlush()
			case <-sinkDone:
				doFlush()
				return
			}
		}
	}()
}

// CloseSink flushes remaining entries and stops the background goroutine.
func CloseSink() {
	sinkMu.Lock()
	if sinkDone != nil {
		close(sinkDone)
		sinkDone = nil
	}
	if sinkTicker != nil {
		sinkTicker.Stop()
		sinkTicker = nil
	}
	sinkURL = ""
	sinkMu.Unlock()
}

func bufferEntry(entry LogEntry) {
	domain := ""
	var metadata map[string]any
	if entry.Context != nil {
		if d, ok := entry.Context["domain"]; ok {
			if ds, ok := d.(string); ok {
				domain = ds
			}
		}
		metadata = make(map[string]any, len(entry.Context))
		for k, v := range entry.Context {
			if k != "domain" {
				metadata[k] = v
			}
		}
		if len(metadata) == 0 {
			metadata = nil
		}
	}

	se := sinkEntry{
		Timestamp: entry.Timestamp.Format(time.RFC3339Nano),
		System:    entry.System,
		Subsystem: entry.Subsystem,
		Level:     strings.ToLower(entry.Level),
		Message:   entry.Message,
		Domain:    domain,
		Metadata:  metadata,
	}

	sinkMu.Lock()
	sinkBuffer = append(sinkBuffer, se)
	shouldFlush := len(sinkBuffer) >= sinkMaxBuffer
	sinkMu.Unlock()

	if shouldFlush {
		doFlush()
	}
}

func doFlush() {
	sinkMu.Lock()
	if len(sinkBuffer) == 0 || sinkURL == "" {
		sinkMu.Unlock()
		return
	}
	entries := sinkBuffer
	sinkBuffer = nil
	url := sinkURL + "/api/client-logs"
	sinkMu.Unlock()

	payload := sinkPayload{Entries: entries}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	postToServer(url, body) // platform-specific
}
