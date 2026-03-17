package main

import (
	"encoding/json"
	"sync"
	"syscall/js"

	logger "github.com/fum4/openkit/libs/logger"
)

var (
	loggers   = make(map[int]*logger.Logger)
	loggersMu sync.Mutex
	nextID    = 1
)

func loggerNew(_ js.Value, args []js.Value) any {
	system := args[0].String()
	subsystem := args[1].String()
	level := args[2].String()
	format := args[3].String()

	l := logger.NewLogger(system, subsystem, level, format)

	loggersMu.Lock()
	id := nextID
	loggers[id] = l
	nextID++
	loggersMu.Unlock()

	return id
}

func loggerLog(method func(*logger.Logger, string, map[string]any)) func(js.Value, []js.Value) any {
	return func(_ js.Value, args []js.Value) any {
		id := args[0].Int()
		message := args[1].String()
		contextJSON := args[2].String()

		loggersMu.Lock()
		l := loggers[id]
		loggersMu.Unlock()

		if l == nil {
			return nil
		}

		var context map[string]any
		if contextJSON != "" && contextJSON != "{}" {
			json.Unmarshal([]byte(contextJSON), &context)
		}

		method(l, message, context)
		return nil
	}
}

func loggerFree(_ js.Value, args []js.Value) any {
	id := args[0].Int()

	loggersMu.Lock()
	delete(loggers, id)
	loggersMu.Unlock()

	return nil
}

func loggerSetSink(_ js.Value, args []js.Value) any {
	serverUrl := args[0].String()
	projectName := args[1].String()
	logger.SetSink(serverUrl, projectName)
	return nil
}

func loggerCloseSink(_ js.Value, args []js.Value) any {
	logger.CloseSink()
	return nil
}

func main() {
	api := js.Global().Get("Object").New()

	api.Set("LoggerNew", js.FuncOf(loggerNew))
	api.Set("LoggerInfo", js.FuncOf(loggerLog((*logger.Logger).Info)))
	api.Set("LoggerWarn", js.FuncOf(loggerLog((*logger.Logger).Warn)))
	api.Set("LoggerError", js.FuncOf(loggerLog((*logger.Logger).Error)))
	api.Set("LoggerDebug", js.FuncOf(loggerLog((*logger.Logger).Debug)))
	api.Set("LoggerSuccess", js.FuncOf(loggerLog((*logger.Logger).Success)))
	api.Set("LoggerStarted", js.FuncOf(loggerLog((*logger.Logger).Started)))
	api.Set("LoggerPlain", js.FuncOf(loggerLog((*logger.Logger).Plain)))
	api.Set("LoggerFree", js.FuncOf(loggerFree))
	api.Set("LoggerSetSink", js.FuncOf(loggerSetSink))
	api.Set("LoggerCloseSink", js.FuncOf(loggerCloseSink))

	js.Global().Set("__openkit_logger", api)

	// Keep the Go runtime alive.
	select {}
}
