import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

export interface TerminalWebViewHandle {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
  blur: () => void;
}

interface TerminalWebViewProps {
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

type TerminalBridgeMessage =
  | { type: "ready" }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "error"; message: string };

function toBridgeMessage(raw: string): TerminalBridgeMessage | null {
  try {
    const parsed = JSON.parse(raw) as TerminalBridgeMessage;
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export const TerminalWebView = forwardRef<TerminalWebViewHandle, TerminalWebViewProps>(
  function TerminalWebView({ onInput, onResize }, ref) {
    const webViewRef = useRef<WebView | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [terminalError, setTerminalError] = useState<string | null>(null);
    const pendingMessagesRef = useRef<string[]>([]);

    const flushPending = useCallback(() => {
      const webView = webViewRef.current;
      if (!webView) return;

      for (const message of pendingMessagesRef.current) {
        webView.postMessage(message);
      }
      pendingMessagesRef.current = [];
    }, []);

    const postToTerminal = useCallback(
      (
        message:
          | { type: "write"; data: string }
          | { type: "clear" }
          | { type: "focus" }
          | { type: "blur" },
      ) => {
        const serialized = JSON.stringify(message);
        const webView = webViewRef.current;
        if (isReady && webView) {
          webView.postMessage(serialized);
          return;
        }
        pendingMessagesRef.current.push(serialized);
      },
      [isReady],
    );

    useImperativeHandle(
      ref,
      () => ({
        write(data: string) {
          postToTerminal({ type: "write", data });
        },
        clear() {
          postToTerminal({ type: "clear" });
        },
        focus() {
          postToTerminal({ type: "focus" });
        },
        blur() {
          postToTerminal({ type: "blur" });
        },
      }),
      [postToTerminal],
    );

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        const payload = toBridgeMessage(event.nativeEvent.data);
        if (!payload) return;

        if (payload.type === "ready") {
          setTerminalError(null);
          setIsReady(true);
          flushPending();
          return;
        }

        if (payload.type === "input") {
          onInput(payload.data);
          return;
        }

        if (
          payload.type === "resize" &&
          typeof payload.cols === "number" &&
          typeof payload.rows === "number"
        ) {
          onResize?.(payload.cols, payload.rows);
          return;
        }

        if (payload.type === "error") {
          setTerminalError(payload.message || "Terminal runtime failed to initialize.");
        }
      },
      [flushPending, onInput, onResize],
    );

    const terminalHtml = useMemo(
      () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm/css/xterm.min.css" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #05090f;
      }
      #terminal {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 8px;
      }
      .xterm-viewport::-webkit-scrollbar {
        width: 0;
        height: 0;
      }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm/lib/xterm.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit/lib/addon-fit.min.js"></script>
    <script>
      (function () {
        function post(message) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(message));
          }
        }

        if (!window.Terminal || !window.FitAddon || !window.FitAddon.FitAddon) {
          post({ type: "error", message: "Failed to load terminal runtime." });
          return;
        }

        const terminalElement = document.getElementById("terminal");
        if (!terminalElement) {
          post({ type: "error", message: "Terminal container missing." });
          return;
        }

        const terminal = new window.Terminal({
          convertEol: false,
          cursorBlink: true,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          theme: {
            background: "#05090f",
            foreground: "#d5ffe5",
            cursor: "#39d98a",
            black: "#1a1f2b",
            red: "#ff7b72",
            green: "#3fb950",
            yellow: "#d29922",
            blue: "#58a6ff",
            magenta: "#d2a8ff",
            cyan: "#56d4dd",
            white: "#b1bac4",
            brightBlack: "#6e7681",
            brightRed: "#ffa198",
            brightGreen: "#56d364",
            brightYellow: "#e3b341",
            brightBlue: "#79c0ff",
            brightMagenta: "#e2c5ff",
            brightCyan: "#76e3ea",
            brightWhite: "#f0f6fc"
          },
          allowTransparency: false
        });
        const fitAddon = new window.FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalElement);

        function resizeAndReport() {
          fitAddon.fit();
          post({ type: "resize", cols: terminal.cols, rows: terminal.rows });
        }

        terminal.onData(function (data) {
          post({ type: "input", data: data });
        });

        function handleIncoming(raw) {
          let message = null;
          try {
            message = JSON.parse(raw);
          } catch (_error) {
            return;
          }
          if (!message || typeof message.type !== "string") return;

          if (message.type === "write" && typeof message.data === "string") {
            terminal.write(message.data);
            return;
          }
          if (message.type === "clear") {
            terminal.clear();
            return;
          }
          if (message.type === "focus") {
            terminal.focus();
            return;
          }
          if (message.type === "blur") {
            if (terminal.textarea && typeof terminal.textarea.blur === "function") {
              terminal.textarea.blur();
              return;
            }
            if (document.activeElement && typeof document.activeElement.blur === "function") {
              document.activeElement.blur();
            }
          }
        }

        window.addEventListener("message", function (event) {
          if (typeof event.data === "string") {
            handleIncoming(event.data);
          }
        });
        document.addEventListener("message", function (event) {
          if (typeof event.data === "string") {
            handleIncoming(event.data);
          }
        });

        window.addEventListener("resize", function () {
          resizeAndReport();
        });

        post({ type: "ready" });
        setTimeout(function () {
          resizeAndReport();
          terminal.focus();
        }, 0);
      })();
    </script>
  </body>
</html>`,
      [],
    );

    return (
      <View style={styles.container}>
        <WebView
          ref={(view) => {
            webViewRef.current = view;
          }}
          originWhitelist={["*"]}
          source={{ html: terminalHtml }}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          showsVerticalScrollIndicator={false}
          style={styles.webview}
        />
        {terminalError ? <Text style={styles.errorText}>{terminalError}</Text> : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    minHeight: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2c3f",
    backgroundColor: "#05090f",
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: "#05090f",
  },
  errorText: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#ff9c9c",
    fontSize: 12,
    borderTopWidth: 1,
    borderTopColor: "#2a1820",
    backgroundColor: "#1c1116",
  },
});
