const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const root_module = b.createModule(.{
        .root_source_file = b.path("src/port-hook.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .imports = &.{
            .{ .name = "logger", .module = b.createModule(.{
                .root_source_file = .{ .cwd_relative = "../logger/zig/logger.zig" },
                .target = target,
                .optimize = optimize,
                .link_libc = true,
            }) },
        },
    });

    // On macOS, add the DYLD_INTERPOSE table (interpose.c) so that the hook
    // works with two-level namespace dylibs.
    if (target.result.os.tag == .macos) {
        root_module.addCSourceFile(.{
            .file = b.path("src/interpose.c"),
        });
    }

    const lib = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "port-hook",
        .root_module = root_module,
    });
    b.installArtifact(lib);
}
