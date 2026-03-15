//go:build js

package logger

import (
	"encoding/json"
	"strings"
	"syscall/js"
)

func emitOutput(_ Formatter, entry LogEntry) {
	console := js.Global().Get("console")
	level := strings.ToLower(entry.Level)

	prefix := "[" + strings.ToUpper(entry.System) + "]"
	if entry.Subsystem != "" {
		prefix += " [" + strings.ToUpper(entry.Subsystem) + "]"
	}

	msg := prefix + " " + entry.Message

	args := []any{msg}
	if len(entry.Context) > 0 {
		ctxJSON, _ := json.Marshal(entry.Context)
		args = append(args, string(ctxJSON))
	}

	switch level {
	case "error":
		console.Call("error", args...)
	case "warn":
		console.Call("warn", args...)
	case "debug":
		console.Call("debug", args...)
	default:
		console.Call("info", args...)
	}
}

func emitPlain(message string, contextStr string) {
	js.Global().Get("console").Call("log", message+contextStr)
}
