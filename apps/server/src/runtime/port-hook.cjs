// Injected into worktree processes via NODE_OPTIONS="--require ..."
// Patches net.Server.prototype.listen and net.Socket.prototype.connect
// to offset known ports by a configurable amount per worktree instance.
"use strict";

const offset = parseInt(process.env.__WM_PORT_OFFSET__ || "0", 10);
const knownPorts = JSON.parse(process.env.__WM_KNOWN_PORTS__ || "[]");
const knownPortSet = new Set(knownPorts);
const LOCALHOST = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", ""]);

function toPort(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

function isLocalhost(host) {
  if (!host) return true;
  return LOCALHOST.has(host);
}

if (offset > 0 && knownPortSet.size > 0) {
  const net = require("net");

  // --- Patch LISTEN (incoming bindings) ---
  const origListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const port =
      typeof args[0] === "number"
        ? args[0]
        : typeof args[0] === "object" && args[0] !== null
          ? toPort(args[0].port)
          : null;

    if (port !== null && knownPortSet.has(port)) {
      const newPort = port + offset;
      if (typeof args[0] === "number") {
        args[0] = newPort;
      } else {
        args[0] = Object.assign({}, args[0], { port: newPort });
      }
      if (process.env.__WM_DEBUG__) console.log(`listen :${port} \u2192 :${newPort}`);
    }

    return origListen.apply(this, args);
  };

  // --- Patch CONNECT (outgoing connections) ---
  // Node.js HTTP agent calls socket.connect([options, cb]) internally,
  // so args[0] can be an array. We handle all calling conventions.
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Case 1: connect(port, [host], [cb]) — port is a number
    if (typeof args[0] === "number") {
      const port = args[0];
      const host = typeof args[1] === "string" ? args[1] : "localhost";
      if (knownPortSet.has(port) && isLocalhost(host)) {
        args[0] = port + offset;
        console.log(`connect :${port} \u2192 :${args[0]}`);
      }
    }
    // Case 2: connect([options, cb]) — Node.js HTTP agent internal call
    else if (Array.isArray(args[0])) {
      const inner = args[0];
      if (inner[0] && typeof inner[0] === "object") {
        const opts = inner[0];
        const port = toPort(opts.port);
        const host = opts.host || opts.hostname || "";
        if (port !== null && knownPortSet.has(port) && isLocalhost(host)) {
          inner[0] = Object.assign({}, opts, { port: port + offset });
          console.log(`connect :${port} \u2192 :${port + offset}`);
        }
      }
    }
    // Case 3: connect(options, [cb]) — plain options object
    else if (typeof args[0] === "object" && args[0] !== null) {
      const opts = args[0];
      const port = toPort(opts.port);
      const host = opts.host || opts.hostname || "";
      if (port !== null && knownPortSet.has(port) && isLocalhost(host)) {
        args[0] = Object.assign({}, opts, { port: port + offset });
        console.log(`connect :${port} \u2192 :${port + offset}`);
      }
    }

    return origConnect.apply(this, args);
  };
}
