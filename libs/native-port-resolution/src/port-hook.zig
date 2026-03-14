const std = @import("std");
const logger = @import("logger");
const c = @cImport({
    @cInclude("sys/socket.h");
    @cInclude("netinet/in.h");
    @cInclude("stdlib.h");
});

// On macOS, DYLD_INTERPOSE routes calls from outside this library through
// hooked_bind/hooked_connect while calls from WITHIN this library to the
// C-imported bind/connect go directly to libc. We reference the originals
// via @cImport, which resolves to the real libc symbols.

// ── Global state ──────────────────────────────────────────────────────

const MAX_KNOWN_PORTS = 64;

var port_offset: u16 = 0;
var known_ports: [MAX_KNOWN_PORTS]u16 = undefined;
var known_ports_len: usize = 0;
var debug_enabled: bool = false;
var initialized: bool = false;
var log: logger.Logger = .{ .handle = 0, .available = false };

// ── Helpers ───────────────────────────────────────────────────────────

fn isKnownPort(port: u16) bool {
    for (known_ports[0..known_ports_len]) |p| {
        if (p == port) return true;
    }
    return false;
}

fn debugLog(comptime fmt: []const u8, args: anytype) void {
    if (!debug_enabled) return;

    // Use structured logger if available, fall back to stderr
    if (log.available) {
        // Format the context as JSON using a stack buffer
        var buf: [1024]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, fmt, args) catch return;
        var msg_z: [1024]u8 = undefined;
        const msg_len = @min(msg.len, msg_z.len - 1);
        @memcpy(msg_z[0..msg_len], msg[0..msg_len]);
        msg_z[msg_len] = 0;
        log.debug(@ptrCast(msg_z[0..msg_len :0]), "");
    } else {
        std.debug.print("[port-hook] " ++ fmt ++ "\n", args);
    }
}

fn isLocalhostV6(addr: *const c.struct_sockaddr_in6) bool {
    const bytes: *const [16]u8 = @ptrCast(&addr.sin6_addr);

    const loopback = [16]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 };
    if (std.mem.eql(u8, bytes, &loopback)) return true;

    const any = [16]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    if (std.mem.eql(u8, bytes, &any)) return true;

    const v4mapped_prefix = [12]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff };
    if (std.mem.eql(u8, bytes[0..12], &v4mapped_prefix) and bytes[12] == 127 and bytes[13] == 0 and bytes[14] == 0 and bytes[15] == 1) return true;

    return false;
}

fn isLocalhostV4(addr: *const c.struct_sockaddr_in) bool {
    const ip = std.mem.bigToNative(u32, addr.sin_addr.s_addr);
    return ip == 0x7f000001 or ip == 0x00000000;
}

fn parseKnownPorts(value: [*:0]const u8) void {
    const slice = std.mem.span(value);
    var i: usize = 0;

    while (i < slice.len and slice[i] != '[') : (i += 1) {}
    if (i >= slice.len) return;
    i += 1;

    while (i < slice.len and slice[i] != ']') {
        while (i < slice.len and (slice[i] < '0' or slice[i] > '9')) : (i += 1) {
            if (slice[i] == ']') return;
        }
        if (i >= slice.len) return;

        var num: u16 = 0;
        while (i < slice.len and slice[i] >= '0' and slice[i] <= '9') : (i += 1) {
            num = num *% 10 +% @as(u16, @intCast(slice[i] - '0'));
        }

        if (known_ports_len < MAX_KNOWN_PORTS) {
            known_ports[known_ports_len] = num;
            known_ports_len += 1;
        }
    }
}

fn ensureInit() void {
    if (initialized) return;
    initialized = true;

    if (c.getenv("__WM_DEBUG__")) |_| {
        debug_enabled = true;
    }

    // Initialize structured logger (dlopen-based, no-op if library unavailable).
    // Level follows debug flag — if debug is on, log everything; otherwise info.
    const level: [*:0]const u8 = if (debug_enabled) "debug" else "info";
    log = logger.Logger.init("port-hook", "", level, "dev");

    const offset_env = c.getenv("__WM_PORT_OFFSET__") orelse return;
    const offset_slice = std.mem.span(offset_env);
    port_offset = std.fmt.parseInt(u16, offset_slice, 10) catch return;
    if (port_offset == 0) return;

    const ports_env = c.getenv("__WM_KNOWN_PORTS__") orelse return;
    parseKnownPorts(ports_env);

    debugLog("initialized: offset={d}, known_ports={d}", .{ port_offset, known_ports_len });
}

// ── Hook functions ────────────────────────────────────────────────────
// Named hooked_bind/hooked_connect so the C interpose table (interpose.c)
// can map them to the real libc bind/connect via DYLD_INTERPOSE.
// Inside these functions, calling c.bind / c.connect goes directly to
// libc because DYLD_INTERPOSE only redirects calls from OTHER libraries.

pub export fn hooked_bind(fd: c_int, addr: *const c.struct_sockaddr, addrlen: c.socklen_t) callconv(.c) c_int {
    ensureInit();

    if (port_offset == 0 or known_ports_len == 0) {
        return c.bind(fd, addr, addrlen);
    }

    if (addr.sa_family == c.AF_INET) {
        const sin: *const c.struct_sockaddr_in = @ptrCast(@alignCast(addr));
        const port = std.mem.bigToNative(u16, sin.sin_port);

        if (isKnownPort(port)) {
            var copy = sin.*;
            const new_port = port +% port_offset;
            copy.sin_port = std.mem.nativeToBig(u16, new_port);
            debugLog("bind: rewriting port {d} -> {d} (IPv4)", .{ port, new_port });
            return c.bind(fd, @ptrCast(&copy), addrlen);
        }
    } else if (addr.sa_family == c.AF_INET6) {
        const sin6: *const c.struct_sockaddr_in6 = @ptrCast(@alignCast(addr));
        const port = std.mem.bigToNative(u16, sin6.sin6_port);

        if (isKnownPort(port)) {
            var copy = sin6.*;
            const new_port = port +% port_offset;
            copy.sin6_port = std.mem.nativeToBig(u16, new_port);
            debugLog("bind: rewriting port {d} -> {d} (IPv6)", .{ port, new_port });
            return c.bind(fd, @ptrCast(&copy), addrlen);
        }
    }

    return c.bind(fd, addr, addrlen);
}

pub export fn hooked_connect(fd: c_int, addr: *const c.struct_sockaddr, addrlen: c.socklen_t) callconv(.c) c_int {
    ensureInit();

    if (port_offset == 0 or known_ports_len == 0) {
        return c.connect(fd, addr, addrlen);
    }

    if (addr.sa_family == c.AF_INET) {
        const sin: *const c.struct_sockaddr_in = @ptrCast(@alignCast(addr));
        const port = std.mem.bigToNative(u16, sin.sin_port);

        if (isKnownPort(port) and isLocalhostV4(sin)) {
            var copy = sin.*;
            const new_port = port +% port_offset;
            copy.sin_port = std.mem.nativeToBig(u16, new_port);
            debugLog("connect: rewriting port {d} -> {d} (IPv4)", .{ port, new_port });
            return c.connect(fd, @ptrCast(&copy), addrlen);
        }
    } else if (addr.sa_family == c.AF_INET6) {
        const sin6: *const c.struct_sockaddr_in6 = @ptrCast(@alignCast(addr));
        const port = std.mem.bigToNative(u16, sin6.sin6_port);

        if (isKnownPort(port) and isLocalhostV6(sin6)) {
            var copy = sin6.*;
            const new_port = port +% port_offset;
            copy.sin6_port = std.mem.nativeToBig(u16, new_port);
            debugLog("connect: rewriting port {d} -> {d} (IPv6)", .{ port, new_port });
            return c.connect(fd, @ptrCast(&copy), addrlen);
        }
    }

    return c.connect(fd, addr, addrlen);
}
