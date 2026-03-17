const std = @import("std");

/// Zig bindings for liblogger (Go-based structured logging library).
///
/// Uses dlopen at runtime so the logger is optional — if liblogger.dylib/.so
/// is not found, all log calls become no-ops. This is important for the
/// port-hook which is loaded via DYLD_INSERT_LIBRARIES into arbitrary
/// processes where the Go runtime may not be desirable.

// ── Function pointer types matching the C API ────────────────────────

const LoggerNewFn = *const fn ([*:0]const u8, [*:0]const u8, [*:0]const u8, [*:0]const u8) callconv(.c) c_int;
const LoggerLogFn = *const fn (c_int, [*:0]const u8, [*:0]const u8) callconv(.c) void;
const LoggerFreeFn = *const fn (c_int) callconv(.c) void;
const LoggerSetSinkFn = *const fn ([*:0]const u8, [*:0]const u8) callconv(.c) void;
const LoggerCloseSinkFn = *const fn () callconv(.c) void;

// ── Resolved symbols (populated on first use) ────────────────────────

const Symbols = struct {
    new: LoggerNewFn,
    info: LoggerLogFn,
    warn: LoggerLogFn,
    err: LoggerLogFn,
    debug: LoggerLogFn,
    success: LoggerLogFn,
    started: LoggerLogFn,
    plain: LoggerLogFn,
    free: LoggerFreeFn,
    set_sink: LoggerSetSinkFn,
    close_sink: LoggerCloseSinkFn,
};

var resolved: ?Symbols = null;
var resolve_attempted: bool = false;

fn resolveSymbols() ?Symbols {
    if (resolve_attempted) return resolved;
    resolve_attempted = true;

    // Try environment override first, then default library name
    const lib_path = blk: {
        const env = std.c.getenv("__WM_LIBLOGGER_PATH");
        if (env) |path| break :blk path;

        if (comptime @import("builtin").os.tag == .macos) {
            break :blk @as([*:0]const u8, "liblogger.dylib");
        } else {
            break :blk @as([*:0]const u8, "liblogger.so");
        }
    };

    const handle = std.c.dlopen(lib_path, .{ .LAZY = true }) orelse return null;

    resolved = Symbols{
        .new = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerNew") orelse return null)),
        .info = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerInfo") orelse return null)),
        .warn = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerWarn") orelse return null)),
        .err = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerError") orelse return null)),
        .debug = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerDebug") orelse return null)),
        .success = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerSuccess") orelse return null)),
        .started = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerStarted") orelse return null)),
        .plain = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerPlain") orelse return null)),
        .free = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerFree") orelse return null)),
        .set_sink = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerSetSink") orelse return null)),
        .close_sink = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerCloseSink") orelse return null)),
    };

    return resolved;
}

// ── Stack-buffer helper for null-termination ─────────────────────────

fn toC(slice: []const u8, buf: *[4096]u8) [*:0]const u8 {
    const len = @min(slice.len, buf.len - 1);
    @memcpy(buf[0..len], slice[0..len]);
    buf[len] = 0;
    return @ptrCast(buf[0..len :0]);
}

// ── Public Logger struct ─────────────────────────────────────────────

pub const Logger = struct {
    handle: c_int,
    available: bool,

    /// Create a new logger instance. If liblogger is not available, returns
    /// a no-op logger (available=false).
    ///
    /// - system: service name (e.g. "port-hook")
    /// - subsystem: sub-component (pass "" for none)
    /// - level: "debug", "info", "warn", "error"
    /// - format: "dev" (colored) or "prod" (JSON)
    pub fn init(system: [*:0]const u8, subsystem: [*:0]const u8, level: [*:0]const u8, format: [*:0]const u8) Logger {
        const syms = resolveSymbols() orelse return .{ .handle = 0, .available = false };
        return .{
            .handle = syms.new(system, subsystem, level, format),
            .available = true,
        };
    }

    pub fn info(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.info(self.handle, msg, context);
    }

    pub fn warn(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.warn(self.handle, msg, context);
    }

    pub fn err(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.err(self.handle, msg, context);
    }

    pub fn debug(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.debug(self.handle, msg, context);
    }

    pub fn success(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.success(self.handle, msg, context);
    }

    pub fn started(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.started(self.handle, msg, context);
    }

    pub fn plain(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = resolved orelse return;
        if (self.available) syms.plain(self.handle, msg, context);
    }

    pub fn deinit(self: *const Logger) void {
        if (!self.available) return;
        const syms = resolved orelse return;
        syms.free(self.handle);
    }

    /// Configure the Go logger to POST entries to a server endpoint.
    pub fn setSink(server_url: [*:0]const u8, project_name: [*:0]const u8) void {
        const syms = resolved orelse return;
        syms.set_sink(server_url, project_name);
    }

    /// Flush remaining entries and stop the sink.
    pub fn closeSink() void {
        const syms = resolved orelse return;
        syms.close_sink();
    }

    /// Returns true if the Go logger library was successfully loaded.
    pub fn isAvailable(self: *const Logger) bool {
        return self.available;
    }
};
