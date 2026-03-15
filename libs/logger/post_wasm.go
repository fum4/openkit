//go:build js

package logger

import "syscall/js"

func postToServer(url string, body []byte) {
	opts := js.Global().Get("Object").New()
	opts.Set("method", "POST")

	headers := js.Global().Get("Object").New()
	headers.Set("Content-Type", "application/json")
	opts.Set("headers", headers)

	bodyStr := string(body)
	opts.Set("body", bodyStr)

	// Fire and forget — don't block on network I/O.
	js.Global().Call("fetch", url, opts)
}
