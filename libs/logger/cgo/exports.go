package main

import "C"
import (
	"encoding/json"
	"sync"

	logger "github.com/fum4/openkit/libs/logger"
)

var (
	loggers   = make(map[int]*logger.Logger)
	loggersMu sync.Mutex
	nextID    = 1
)

//export LoggerNew
func LoggerNew(system, subsystem, level, format *C.char) C.int {
	loggersMu.Lock()
	defer loggersMu.Unlock()

	l := logger.NewLogger(
		C.GoString(system),
		C.GoString(subsystem),
		C.GoString(level),
		C.GoString(format),
	)

	id := nextID
	loggers[id] = l
	nextID++

	return C.int(id)
}

//export LoggerInfo
func LoggerInfo(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Info(C.GoString(message), context)
}

//export LoggerWarn
func LoggerWarn(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Warn(C.GoString(message), context)
}

//export LoggerError
func LoggerError(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Error(C.GoString(message), context)
}

//export LoggerDebug
func LoggerDebug(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Debug(C.GoString(message), context)
}

//export LoggerSuccess
func LoggerSuccess(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Success(C.GoString(message), context)
}

//export LoggerStarted
func LoggerStarted(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Started(C.GoString(message), context)
}

//export LoggerPlain
func LoggerPlain(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Plain(C.GoString(message), context)
}

//export LoggerFree
func LoggerFree(id C.int) {
	loggersMu.Lock()
	defer loggersMu.Unlock()

	delete(loggers, int(id))
}

//export LoggerSetSink
func LoggerSetSink(serverUrl, projectName *C.char) {
	logger.SetSink(C.GoString(serverUrl), C.GoString(projectName))
}

//export LoggerCloseSink
func LoggerCloseSink() {
	logger.CloseSink()
}

func getLogger(id int) *logger.Logger {
	loggersMu.Lock()
	defer loggersMu.Unlock()

	return loggers[id]
}

func parseContext(contextJSON string) map[string]any {
	if contextJSON == "" || contextJSON == "{}" {
		return nil
	}

	var context map[string]any
	json.Unmarshal([]byte(contextJSON), &context)
	return context
}

func main() {}
