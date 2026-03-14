package logger

import "strings"

const (
	Reset   = "\033[0m"
	Gray    = "\033[90m"
	Red     = "\033[31m"
	Green   = "\033[32m"
	Yellow  = "\033[33m"
	Blue    = "\033[34m"
	Cyan    = "\033[36m"
	Magenta = "\033[35m"
	Bold    = "\033[1m"
)

func getLevelColor(level string) string {
	switch level {
	case "DEBUG":
		return Gray
	case "INFO":
		return Green
	case "SUCCESS":
		return Green
	case "WARN":
		return Yellow
	case "ERROR":
		return Red
	default:
		return Reset
	}
}

// System color mapping - customize colors for different services
var systemColors = map[string]string{
	"API": Blue,
	"AI":  Magenta,
	"UI":  Cyan,
}

func getSystemColor(system string) string {
	// Normalize system to uppercase for lookup
	normalizedSystem := strings.ToUpper(system)

	if color, ok := systemColors[normalizedSystem]; ok {
		return color
	}

	// Default color for unknown systems
	return Blue
}

// getDarkerColor returns a dimmer version of the given color for subsystems
func getDarkerColor(color string) string {
	// Map normal colors to their dimmed equivalents (using dim mode)
	dimColors := map[string]string{
		Blue:    "\033[2;34m", // Blue dimmed
		Magenta: "\033[2;35m", // Magenta dimmed
		Cyan:    "\033[2;36m", // Cyan dimmed
		Green:   "\033[2;32m", // Green dimmed
		Yellow:  "\033[2;33m", // Yellow dimmed
		Red:     "\033[2;31m", // Red dimmed
	}

	if dimColor, ok := dimColors[color]; ok {
		return dimColor
	}

	// If no mapping, return gray as fallback
	return Gray
}
