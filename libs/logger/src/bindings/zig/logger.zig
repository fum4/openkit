const bindings = @import("bindings.zig");

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
        const syms = bindings.loadBindings() orelse return .{ .handle = 0, .available = false };
        return .{
            .handle = syms.new(system, subsystem, level, format),
            .available = true,
        };
    }

    pub fn info(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.info(self.handle, msg, context);
    }

    pub fn warn(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.warn(self.handle, msg, context);
    }

    pub fn err(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.err(self.handle, msg, context);
    }

    pub fn debug(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.debug(self.handle, msg, context);
    }

    pub fn success(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.success(self.handle, msg, context);
    }

    pub fn started(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.started(self.handle, msg, context);
    }

    pub fn plain(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        if (self.available) syms.plain(self.handle, msg, context);
    }

    pub fn deinit(self: *const Logger) void {
        if (!self.available) return;
        const syms = bindings.resolved orelse return;
        syms.free(self.handle);
    }

    /// Configure the Go logger to POST entries to a server endpoint.
    pub fn setSink(server_url: [*:0]const u8, project_name: [*:0]const u8) void {
        const syms = bindings.resolved orelse return;
        syms.set_sink(server_url, project_name);
    }

    /// Flush remaining entries and stop the sink.
    pub fn closeSink() void {
        const syms = bindings.resolved orelse return;
        syms.close_sink();
    }

    /// Returns true if the Go logger library was successfully loaded.
    pub fn isAvailable(self: *const Logger) bool {
        return self.available;
    }
};
