//go:build !js

package logger

import "fmt"

func emitOutput(formatter Formatter, entry LogEntry) {
	fmt.Print(formatter.Format(entry))
}

func emitPlain(message string, contextStr string) {
	fmt.Println(message + contextStr)
}
