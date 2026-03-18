const std = @import("std");

/// Zig FFI bindings for liblogger (Go-based structured logging library).
///
/// Uses dlopen at runtime so the logger is optional — if liblogger.dylib/.so
/// is not found, all log calls become no-ops. This is important for the
/// port-hook which is loaded via DYLD_INSERT_LIBRARIES into arbitrary
/// processes where the Go runtime may not be desirable.

// ── Function pointer types matching the C API ────────────────────────

pub const LoggerNewFn = *const fn ([*:0]const u8, [*:0]const u8, [*:0]const u8, [*:0]const u8) callconv(.c) c_int;
pub const LoggerLogFn = *const fn (c_int, [*:0]const u8, [*:0]const u8) callconv(.c) void;
pub const LoggerFreeFn = *const fn (c_int) callconv(.c) void;
pub const LoggerSetSinkFn = *const fn ([*:0]const u8, [*:0]const u8) callconv(.c) void;
pub const LoggerCloseSinkFn = *const fn () callconv(.c) void;

// ── Resolved symbols (populated on first use) ────────────────────────

pub const Symbols = struct {
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

pub var resolved: ?Symbols = null;
var load_attempted: bool = false;

pub fn loadBindings() ?Symbols {
    if (load_attempted) return resolved;
    load_attempted = true;

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
