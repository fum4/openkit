import net from "net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { EventEmitter } from "events";

import { ProjectManager } from "./project-manager.js";

vi.mock("fs");
vi.mock("./logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("./dev-mode.js", () => ({
  symlinkOpsLog: vi.fn(),
}));
vi.mock("./preferences-manager.js", () => ({
  preferencesManager: {
    getBasePort: vi.fn(() => 6969),
    isDevMode: vi.fn(() => false),
    getDevModeRepoPath: vi.fn(() => null),
  },
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

// Mock child process that emits events like a real ChildProcess
function createMockChildProcess() {
  const cp = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  cp.pid = 12345;
  cp.killed = false;
  cp.kill = vi.fn();
  return cp;
}

// Track mock servers to control port availability
let mockServerBehaviors: Map<number, boolean>;

// Allow tests to hook into waitForServerReady with custom behavior
let waitForServerReadyImpl: (() => Promise<boolean>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockServerBehaviors = new Map();
  waitForServerReadyImpl = null;

  // Default: STATE_DIR exists, no state file, .git exists
  mockExistsSync.mockImplementation((p) => {
    const s = String(p);
    if (s.endsWith(".openkit")) return true;
    if (s.endsWith("app-state.json")) return false;
    if (s.endsWith(".git")) return true;
    if (s.endsWith("electron.lock")) return false;
    return false;
  });
  mockReadFileSync.mockReturnValue("{}");
  mockWriteFileSync.mockImplementation(() => {});
  vi.mocked(mkdirSync).mockImplementation(() => undefined as unknown as string);

  // Mock net.createServer to use our configurable port behaviors
  vi.spyOn(net, "createServer").mockImplementation(() => {
    const server = new EventEmitter() as net.Server;
    server.listen = vi.fn(function (this: net.Server, port: number) {
      const isFree = mockServerBehaviors.get(port) ?? true;
      if (isFree) {
        process.nextTick(() => this.emit("listening"));
      } else {
        process.nextTick(() => this.emit("error", new Error("EADDRINUSE")));
      }
      return this;
    }) as unknown as net.Server["listen"];
    server.close = vi.fn(function (this: net.Server, cb?: () => void) {
      if (cb) process.nextTick(cb);
      return this;
    }) as unknown as net.Server["close"];
    server.unref = vi.fn(() => server);
    return server;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock the server spawner to avoid actually spawning processes
vi.mock("./server-spawner.js", () => ({
  spawnServer: vi.fn(() => createMockChildProcess()),
  waitForServerReady: vi.fn(async () => {
    if (waitForServerReadyImpl) return waitForServerReadyImpl();
    return true;
  }),
  stopServer: vi.fn(async () => {}),
}));

describe("ProjectManager", () => {
  describe("allocatePort (via openProject)", () => {
    it("allocates the first available port after basePort", async () => {
      const pm = new ProjectManager();
      const result = await pm.openProject("/test/project-a");

      expect(result.success).toBe(true);
      // basePort is 6969, first project gets 6970
      expect(result.project?.port).toBe(6970);
    });

    it("skips ports already in use by other projects", async () => {
      const pm = new ProjectManager();

      const result1 = await pm.openProject("/test/project-a");
      expect(result1.project?.port).toBe(6970);

      const result2 = await pm.openProject("/test/project-b");
      expect(result2.success).toBe(true);
      expect(result2.project?.port).toBe(6971);
    });

    it("skips ports that are not free on the system", async () => {
      // Port 6970 is occupied on the system
      mockServerBehaviors.set(6970, false);

      const pm = new ProjectManager();
      const result = await pm.openProject("/test/project-a");

      expect(result.success).toBe(true);
      expect(result.project?.port).toBe(6971);
    });

    it("returns error when no ports are available", async () => {
      // Make all ports unavailable by mocking createServer to always fail
      vi.mocked(net.createServer).mockImplementation(() => {
        const server = new EventEmitter() as net.Server;
        server.listen = vi.fn(function (this: net.Server) {
          process.nextTick(() => this.emit("error", new Error("EADDRINUSE")));
          return this;
        }) as unknown as net.Server["listen"];
        server.close = vi.fn(function (this: net.Server, cb?: () => void) {
          if (cb) process.nextTick(cb);
          return this;
        }) as unknown as net.Server["close"];
        server.unref = vi.fn(() => server);
        return server;
      });

      const pm = new ProjectManager();
      const result = await pm.openProject("/test/project-a");

      expect(result.success).toBe(false);
      expect(result.error).toBe("No available port found");
    });

    it("tracks pending ports to avoid collisions with in-flight allocations", async () => {
      // Verify the pendingPort is released after openProject completes,
      // allowing a second project to reuse the scan starting point.
      const pm = new ProjectManager();

      const r1 = await pm.openProject("/test/project-a");
      expect(r1.project?.port).toBe(6970);

      // The second project should get 6971 (not 6970, which is in use by project-a)
      const r2 = await pm.openProject("/test/project-b");
      expect(r2.project?.port).toBe(6971);

      // Close project-a, freeing port 6970 in the projects map
      await pm.closeProject(r1.project!.id);

      // Third project should be able to get 6970 again since it's free
      const r3 = await pm.openProject("/test/project-c");
      expect(r3.project?.port).toBe(6970);
    });
  });

  describe("openProject", () => {
    it("returns existing project if already open", async () => {
      const pm = new ProjectManager();

      const result1 = await pm.openProject("/test/project-a");
      const result2 = await pm.openProject("/test/project-a");

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.project?.id).toBe(result2.project?.id);
      expect(result1.project?.port).toBe(result2.project?.port);
    });

    it("rejects non-git directories", async () => {
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".openkit")) return true;
        if (s.endsWith(".git")) return false;
        return false;
      });

      const pm = new ProjectManager();
      const result = await pm.openProject("/test/not-a-repo");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not a git repository");
    });

    it("reads project name from package.json", async () => {
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".openkit")) return true;
        if (s.endsWith(".git")) return true;
        if (s.endsWith("package.json")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith("package.json")) {
          return JSON.stringify({ name: "my-awesome-project" });
        }
        return "{}";
      });

      const pm = new ProjectManager();
      const result = await pm.openProject("/test/project-a");

      expect(result.success).toBe(true);
      expect(result.project?.name).toBe("my-awesome-project");
    });

    it("falls back to directory name when package.json has no name", async () => {
      const pm = new ProjectManager();
      const result = await pm.openProject("/test/project-a");

      expect(result.success).toBe(true);
      expect(result.project?.name).toBe("project-a");
    });
  });

  describe("stdout port correction", () => {
    it("updates project port when stdout emits port marker", async () => {
      const { spawnServer } = await import("./server-spawner.js");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawnServer).mockReturnValue(
        mockProcess as unknown as ReturnType<typeof spawnServer>,
      );

      // Make waitForServerReady wait until we emit the port marker
      let resolveReady!: (v: boolean) => void;
      waitForServerReadyImpl = () => new Promise((r) => (resolveReady = r));

      const pm = new ProjectManager();
      const resultPromise = pm.openProject("/test/project-a");

      // Wait for listeners to be attached
      await vi.waitFor(() => {
        expect(mockProcess.stdout.listenerCount("data")).toBeGreaterThan(0);
      });

      // Emit port marker then resolve readiness
      mockProcess.stdout.emit("data", Buffer.from("__OPENKIT_PORT__=7777\n"));
      resolveReady(true);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.project?.port).toBe(7777);
    });

    it("handles port marker split across chunks", async () => {
      const { spawnServer } = await import("./server-spawner.js");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawnServer).mockReturnValue(
        mockProcess as unknown as ReturnType<typeof spawnServer>,
      );

      let resolveReady!: (v: boolean) => void;
      waitForServerReadyImpl = () => new Promise((r) => (resolveReady = r));

      const pm = new ProjectManager();
      const resultPromise = pm.openProject("/test/project-a");

      await vi.waitFor(() => {
        expect(mockProcess.stdout.listenerCount("data")).toBeGreaterThan(0);
      });

      // Split the marker across two data events
      mockProcess.stdout.emit("data", Buffer.from("__OPENKIT_PO"));
      mockProcess.stdout.emit("data", Buffer.from("RT__=8888\n"));
      resolveReady(true);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.project?.port).toBe(8888);
    });

    it("captures server errors from stderr across chunks", async () => {
      const { spawnServer } = await import("./server-spawner.js");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawnServer).mockReturnValue(
        mockProcess as unknown as ReturnType<typeof spawnServer>,
      );

      let resolveReady!: (v: boolean) => void;
      waitForServerReadyImpl = () => new Promise((r) => (resolveReady = r));

      const pm = new ProjectManager();
      const resultPromise = pm.openProject("/test/project-a");

      await vi.waitFor(() => {
        expect(mockProcess.stderr.listenerCount("data")).toBeGreaterThan(0);
      });

      // Split error across chunks
      mockProcess.stderr.emit("data", Buffer.from("Cannot find pack"));
      mockProcess.stderr.emit("data", Buffer.from("age 'missing-dep'\n"));
      resolveReady(false);

      const result = await resultPromise;
      // Server failed, error should include the stderr message
      expect(result.project?.status).toBe("error");
    });
  });

  describe("closeProject", () => {
    it("removes project and switches active to remaining", async () => {
      const pm = new ProjectManager();

      const r1 = await pm.openProject("/test/project-a");
      const r2 = await pm.openProject("/test/project-b");
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      pm.setActiveProject(r1.project!.id);
      expect(pm.getActiveProjectId()).toBe(r1.project!.id);

      await pm.closeProject(r1.project!.id);
      expect(pm.getProject(r1.project!.id)).toBeNull();
      // Active should switch to remaining project
      expect(pm.getActiveProjectId()).toBe(r2.project!.id);
    });

    it("sets active to null when last project is closed", async () => {
      const pm = new ProjectManager();

      const r = await pm.openProject("/test/project-a");
      await pm.closeProject(r.project!.id);

      expect(pm.getActiveProjectId()).toBeNull();
      expect(pm.getProjects()).toEqual([]);
    });
  });

  describe("onChange", () => {
    it("notifies listeners when projects change", async () => {
      const pm = new ProjectManager();
      const callback = vi.fn();
      pm.onChange(callback);

      await pm.openProject("/test/project-a");

      expect(callback).toHaveBeenCalled();
    });

    it("supports unsubscribing", async () => {
      const pm = new ProjectManager();
      const callback = vi.fn();
      const unsubscribe = pm.onChange(callback);

      unsubscribe();
      callback.mockClear();

      await pm.openProject("/test/project-a");

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("restoreProjects", () => {
    it("restores previously saved projects", async () => {
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".openkit")) return true;
        if (s.endsWith("app-state.json")) return true;
        if (s.endsWith(".git")) return true;
        if (s.endsWith("electron.lock")) return false;
        // restoreProjects filters with existsSync(projectDir) — match exact dirs
        if (s === "/test/project-a" || s === "/test/project-b") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith("app-state.json")) {
          return JSON.stringify({
            openProjects: [
              { projectDir: "/test/project-a", lastOpened: "2026-03-17T00:00:00Z" },
              { projectDir: "/test/project-b", lastOpened: "2026-03-17T00:00:00Z" },
            ],
            lastActiveProjectDir: "/test/project-b",
          });
        }
        return "{}";
      });

      const pm = new ProjectManager();
      await pm.restoreProjects();

      const projects = pm.getProjects();
      expect(projects).toHaveLength(2);

      // Verify the last active project was restored
      const active = pm.getActiveProject();
      expect(active?.projectDir).toBe("/test/project-b");
    });

    it("skips non-existent project directories", async () => {
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".openkit")) return true;
        if (s.endsWith("app-state.json")) return true;
        // The project directory itself doesn't exist
        if (s === "/test/project-gone") return false;
        if (s.endsWith(".git")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith("app-state.json")) {
          return JSON.stringify({
            openProjects: [
              { projectDir: "/test/project-gone", lastOpened: "2026-03-17T00:00:00Z" },
            ],
            lastActiveProjectDir: null,
          });
        }
        return "{}";
      });

      const pm = new ProjectManager();
      await pm.restoreProjects();

      expect(pm.getProjects()).toHaveLength(0);
    });
  });
});
