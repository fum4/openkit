package logger

import (
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"time"
)

type LogEntry struct {
	Timestamp time.Time
	System    string
	Subsystem string
	Level     string
	Message   string
	Context   map[string]any
}

type Formatter interface {
	Format(entry LogEntry) string
}

type DevFormatter struct{}

func (f *DevFormatter) Format(entry LogEntry) string {
	// Format: HH:MM:SS.MS (e.g., 14:32:45.123)
	timestamp := entry.Timestamp.Format("15:04:05.000")
	levelColor := getLevelColor(entry.Level)
	systemColor := getSystemColor(entry.System)
	system := strings.ToUpper(entry.System)

	contextStr := ""
	if len(entry.Context) > 0 {
		contextJSON, _ := json.Marshal(entry.Context)
		contextStr = " " + string(contextJSON)
	}

	// Build subsystem part if provided
	subsystemPart := ""
	if entry.Subsystem != "" {
		subsystem := strings.ToUpper(entry.Subsystem)
		subsystemPart = fmt.Sprintf(" | %s%s%s", systemColor, subsystem, Reset)
	}

	// SUCCESS shows as INFO in the level column with a green bullet prefix
	displayLevel := entry.Level
	messagePrefix := ""
	if entry.Level == "SUCCESS" {
		displayLevel = "INFO"
		messagePrefix = Green + "●" + Reset + " "
	}

	return fmt.Sprintf("%s%s%s | %s%s%s | %s%s%s%s | %s%s%s%s%s\n",
		Gray, timestamp, Reset,
		systemColor+Bold, system, Reset,
		levelColor, displayLevel, Reset,
		subsystemPart,
		messagePrefix, entry.Message,
		Gray, contextStr, Reset,
	)
}

type ProdFormatter struct{}

func (f *ProdFormatter) Format(entry LogEntry) string {
	output := map[string]any{
		"timestamp": entry.Timestamp.Format(time.RFC3339Nano),
		"system":    entry.System,
		"level":     strings.ToLower(entry.Level),
		"message":   entry.Message,
	}

	// Add subsystem if provided
	if entry.Subsystem != "" {
		output["subsystem"] = entry.Subsystem
	}

	maps.Copy(output, entry.Context)
	jsonBytes, _ := json.Marshal(output)

	return string(jsonBytes)
}
