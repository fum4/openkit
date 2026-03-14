package logger

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Logger struct {
	system    string
	subsystem string
	level     string
	formatter Formatter
	mu        sync.Mutex
}

func NewLogger(system, subsystem, level, format string) *Logger {
	var formatter Formatter

	if format == "prod" || os.Getenv("NODE_ENV") == "production" {
		formatter = &ProdFormatter{}
	} else {
		formatter = &DevFormatter{}
	}

	if level == "" {
		level = os.Getenv("LOG_LEVEL")
		if level == "" {
			level = "INFO"
		}
	}

	// Auto-detect system from directory if not provided
	if system == "" {
		system = detectSystem()
	}

	return &Logger{
		system:    system,
		subsystem: subsystem,
		level:     strings.ToUpper(level),
		formatter: formatter,
	}
}

// detectSystem attempts to detect the system from the current working directory
// by finding the first directory under 'apps/' or 'packages/'
func detectSystem() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "UNKNOWN"
	}

	// Split path into parts
	parts := strings.Split(filepath.Clean(cwd), string(filepath.Separator))

	// Look for 'apps' or 'packages' in the path
	for i, part := range parts {
		if (part == "apps" || part == "packages") && i+1 < len(parts) {
			// Return the directory immediately after apps/packages
			return parts[i+1]
		}
	}

	// Fallback: return last directory name
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}

	return "UNKNOWN"
}

func (l *Logger) shouldLog(level string) bool {
	levels := map[string]int{
		"DEBUG":   0,
		"INFO":    1,
		"SUCCESS": 1,
		"WARN":    2,
		"ERROR":   3,
	}

	return levels[level] >= levels[l.level]
}

func (l *Logger) log(level, message string, context map[string]any) {
	if !l.shouldLog(level) {
		return
	}

	entry := LogEntry{
		Timestamp: time.Now().UTC(),
		System:    l.system,
		Subsystem: l.subsystem,
		Level:     level,
		Message:   message,
		Context:   context,
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	fmt.Println(l.formatter.Format(entry))
}

func (l *Logger) Debug(message string, context map[string]any) {
	l.log("DEBUG", message, context)
}

func (l *Logger) Info(message string, context map[string]any) {
	l.log("INFO", message, context)
}

func (l *Logger) Warn(message string, context map[string]any) {
	l.log("WARN", message, context)
}

func (l *Logger) Error(message string, context map[string]any) {
	l.log("ERROR", message, context)
}

func (l *Logger) Success(message string, context map[string]any) {
	l.log("SUCCESS", message, context)
}

func (l *Logger) Plain(message string, context map[string]any) {
	l.mu.Lock()
	defer l.mu.Unlock()

	contextStr := ""
	if len(context) > 0 {
		contextJSON, _ := json.Marshal(context)
		contextStr = " " + string(contextJSON)
	}

	fmt.Println(message + contextStr)
}
