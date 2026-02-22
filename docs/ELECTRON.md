# Electron App

OpenKit includes an optional Electron app that provides a native desktop experience. When the Electron app is installed, the `OpenKit` CLI automatically opens projects in it instead of falling back to the browser. The Electron layer adds multi-project tab management, system tray integration, session persistence, and a custom URL protocol for deep linking.

## Architecture Overview

The Electron app is structured across several modules in the `electron/` directory:

| File                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `electron/main.ts`                 | Main process: window creation, IPC handlers, tray, protocol handling |
| `electron/preload.ts`              | TypeScript source for the preload script (reference only)            |
| `electron/preload.cjs`             | CommonJS preload script that bridges renderer and main process       |
| `electron/project-manager.ts`      | Manages multiple project connections and server lifecycles           |
| `electron/notification-manager.ts` | Native OS notifications from project SSE activity streams            |
| `electron/preferences-manager.ts`  | Persists window state, sidebar width, and app preferences            |
| `electron/server-spawner.ts`       | Spawns and stops OpenKit backend server processes                       |
| `electron/tsconfig.json`           | TypeScript config for compiling electron sources to `dist/electron/` |

The renderer loads the same React SPA that the browser mode uses (`dist/ui/index.html`), but with additional capabilities exposed through `window.electronAPI` via the preload script.

## Launch Methods

When you run `OpenKit` from a project directory, the CLI in `src/cli/index.ts` decides where to open the UI through a three-step detection cascade:

### 1. Check for Installed .app Bundle (macOS)

The CLI uses macOS Spotlight (`mdfind`) to search for an installed application with bundle ID `com.openkit.app`:

```
mdfind 'kMDItemCFBundleIdentifier == "com.openkit.app"'
```

If found, it opens the project via the `OpenKit://` custom protocol, which the installed app handles.

### 2. Check for Electron in Dev Mode

If no installed app is found, the CLI looks for the Electron binary at the OpenKit project's own `node_modules/.bin/electron` and the compiled main process entry at `dist/electron/main.js`. If both exist, it spawns Electron directly:

```
electron <projectRoot> --port <port>
```

The process is spawned detached so the CLI can exit immediately.

### 3. Prompt to Install Desktop App (macOS, Interactive TTY)

If neither Electron option is available and the terminal is interactive (`process.stdin.isTTY`), the CLI prompts the user to install the desktop app. If the user accepts:

1. Fetches the latest release from `https://api.github.com/repos/fum4/worktree-manager/releases/latest`
2. Finds the DMG asset matching the current architecture (`arm64` or `x64`)
3. Downloads the DMG with `curl`
4. Mounts it with `hdiutil`, copies the `.app` to `/Applications/` (falls back to `~/Applications/` if no write access)
5. Cleans up the mount and temp files
6. Opens the freshly installed app via the `OpenKit://` protocol

All errors are caught gracefully — if anything fails, the CLI falls back to just printing the server URL.

### 4. Non-Interactive Fallback

If the terminal is non-interactive (no TTY) or the user declines the install prompt, the CLI prints the server URL without opening any UI. This is equivalent to `--no-open` behavior for the UI opening step.

### Existing Instance Detection

Before any of the above, the CLI checks whether the Electron app is already running by reading the lock file at `~/.openkit/electron.lock`. This file contains the PID of the running Electron process. The CLI verifies the process is alive with `process.kill(pid, 0)`. If a running instance is found, the CLI sends the project directory to it via the `OpenKit://open-project` protocol URL and exits -- the project opens as a new tab in the existing window.

## `OpenKit://` Protocol

The app registers itself as the handler for the `OpenKit://` custom URL scheme. This enables deep linking from the CLI or other applications.

### Supported URLs

**`OpenKit://open?port=<port>`**

Opens the Electron app and connects to a OpenKit server already running on the specified port. Used by the CLI when launching via an installed `.app` bundle. This is the legacy protocol path -- it shows the window and focuses it.

**`OpenKit://open-project?dir=<encodedDir>`**

Opens a project directory in the app. The `dir` parameter must be URL-encoded. The app will spawn a new OpenKit server for the project directory and add it as a tab. Used by the CLI when sending a project to an already-running Electron instance.

### Protocol Registration

In development mode (when `process.defaultApp` is true), the protocol is registered with the current executable path so that `OpenKit://` URLs route to the dev Electron process. In production (packaged `.app`), the protocol is registered without arguments, relying on the OS association.

### Single Instance Lock

The app enforces a single instance via `app.requestSingleInstanceLock()`. If a second instance is launched, the existing instance receives the `second-instance` event with the new process's argv. Any `OpenKit://` URL in argv is handled by the running instance, and its window is focused.

## Multi-Project Support

The Electron app can manage multiple OpenKit projects simultaneously, each running its own backend server. This is handled by `ProjectManager` (`electron/project-manager.ts`).

### How It Works

Each project gets:

- A unique ID derived from a hash of its absolute directory path
- An allocated port (incrementing from the base port)
- A spawned OpenKit server process (`<runtime> dist/cli/index.js --no-open`)
- A status lifecycle: `starting` -> `running` | `error` -> `stopped`

The project name is resolved from the project's `package.json` name field, falling back to the directory name.

### Server Spawning

`ServerSpawner` (`electron/server-spawner.ts`) handles the process lifecycle:

- **Spawn**: Runs `<runtime> <cliPath> --no-open` with `OPENKIT_PORT` and `OPENKIT_NO_OPEN` environment variables set. In packaged builds, it uses the app's own Electron binary in Node mode (`ELECTRON_RUN_AS_NODE=1`) so the CLI can resolve dependencies from `app.asar`.
- **Readiness check**: Polls `GET http://localhost:<port>/api/config` every 500ms until it responds with HTTP 200, with a 30-second timeout.
- **Shutdown**: Sends `SIGTERM` for graceful shutdown, then `SIGKILL` after 5 seconds if the process has not exited.

Debug output from spawned servers is logged to `/tmp/OpenKit-debug.log`.

### Tab Bar

The renderer receives project and active-project updates from the main process via IPC events (`projects-changed`, `active-project-changed`). The `ServerContext` (`src/ui/contexts/ServerContext.tsx`) translates the active project's port into a `serverUrl` that all API hooks use for data fetching and SSE connections.

Switching tabs changes the active project in the main process, which updates the `serverUrl` in the renderer, causing React Query to refetch against the new backend.

### Session Persistence

`ProjectManager` saves its state to `~/.openkit/app-state.json`:

```json
{
  "openProjects": [{ "projectDir": "/path/to/project", "lastOpened": "2025-01-15T10:30:00.000Z" }],
  "lastActiveProjectDir": "/path/to/project"
}
```

On launch, if no projects are open (no `--project` flag, no protocol URL), the app calls `restoreProjects()` to reopen all previously open projects in parallel and restore the last active tab.

## PreferencesManager

`PreferencesManager` (`electron/preferences-manager.ts`) is a singleton that persists user preferences to `~/.openkit/app-preferences.json`.

### Stored Preferences

| Key               | Type                                | Default | Description                                        |
| ----------------- | ----------------------------------- | ------- | -------------------------------------------------- |
| `basePort`        | `number`                            | `6969`  | Starting port for allocating project server ports  |
| `setupPreference` | `'auto' \| 'manual' \| 'ask'`       | `'ask'` | How to handle projects without `.openkit/config.json` |
| `sidebarWidth`    | `number`                            | `300`   | Persisted sidebar width in pixels                  |
| `windowBounds`    | `{ x?, y?, width, height } \| null` | `null`  | Last window position and size                      |

Window bounds are saved on every resize/move (unless the window is maximized or minimized) and restored on the next launch.

### Lock File

`ProjectManager` writes `~/.openkit/electron.lock` containing `{ "pid": <number> }` on startup. This file is used by the CLI to detect a running Electron instance. The lock file is removed on app quit (`before-quit` event).

## Preload Script and Context Isolation

The Electron app uses strict context isolation. The preload script (`electron/preload.cjs`) uses `contextBridge.exposeInMainWorld` to expose a limited API on `window.electronAPI`.

### Window Configuration

```ts
{
  nodeIntegration: false,    // No Node.js in renderer
  contextIsolation: true,    // Separate preload/renderer contexts
}
```

### Exposed API (`window.electronAPI`)

The preload script exposes the following methods:

**Platform detection:**

- `isElectron: true` -- static flag for the renderer to detect Electron mode

**Folder picker:**

- `selectFolder(): Promise<string | null>` -- opens a native OS folder picker dialog

**Project management:**

- `openProject(folderPath): Promise<{ success, project?, error? }>` -- opens a project directory
- `closeProject(projectId): Promise<void>` -- closes a project and stops its server
- `getProjects(): Promise<Project[]>` -- returns all open projects
- `getActiveProject(): Promise<string | null>` -- returns the active project ID
- `switchTab(projectId): Promise<boolean>` -- switches to a different project tab

**Event subscriptions:**

- `onProjectsChanged(callback): () => void` -- subscribes to project list updates, returns unsubscribe function
- `onActiveProjectChanged(callback): () => void` -- subscribes to active project changes, returns unsubscribe function

**Preferences:**

- `getPreferences(): Promise<AppPreferences>` -- returns all preferences
- `getSetupPreference(): Promise<SetupPreference>` -- returns setup mode
- `setSetupPreference(preference): Promise<void>` -- sets setup mode
- `getSidebarWidth(): Promise<number>` -- returns sidebar width
- `setSidebarWidth(width): Promise<void>` -- sets sidebar width
- `updatePreferences(updates): Promise<void>` -- partial preference update

All communication between the renderer and main process goes through `ipcRenderer.invoke` (request/response) and `ipcRenderer.on` (events). The renderer never has direct access to Node.js APIs.

## System Tray

The app creates a system tray icon on startup with a context menu that includes:

- A list of all open projects (clicking one switches to it and focuses the window)
- "Open Project..." to show the main window
- "Quit" to close all projects and exit

On macOS, closing the window hides it to the tray instead of quitting the app. Clicking the tray icon toggles window visibility. The tray menu is rebuilt whenever the project list changes.

The tray icon is a small PNG encoded as a base64 string in `main.ts`, set as a template image (adapts to light/dark menu bar on macOS).

## Native OS Notifications

`NotificationManager` (`electron/notification-manager.ts`) subscribes to activity event streams from all open projects and fires native OS notifications when the app window is unfocused.

### How It Works

1. When projects change (added, removed, status transitions), `syncProjectStreams()` is called
2. For each running project, it opens an HTTP connection to `http://localhost:<port>/api/events` (the SSE endpoint)
3. It parses incoming SSE `data:` lines looking for `{ type: "activity", event: {...} }` messages
4. If the event type is in the notification set and the main window is not focused, it fires a native `Notification`
5. Clicking the notification shows and focuses the main window

### Notification Events

Only high-priority events trigger native notifications:

- `creation_completed` -- worktree finished creating
- `creation_failed` -- worktree creation failed
- `skill_failed` -- an agent skill hook failed
- `pr_merged` -- a pull request was merged
- `crashed` -- a worktree process crashed

### Debouncing

Notifications are debounced at 10 seconds per project to avoid spam. If multiple events fire within 10 seconds for the same project, only the first triggers a notification.

### Connection Management

- Connections are keyed by project port number
- When a project is closed or stops running, its SSE connection is destroyed
- If a connection drops (server restart, network error), it automatically reconnects after 5 seconds
- All connections are cleaned up on app quit via `dispose()`

## Build Configuration

The `electron-builder.yml` file configures the packaged app:

```yaml
appId: com.openkit.app
productName: OpenKit
```

### Build Targets

- **macOS DMG**: Universal builds for both `arm64` (Apple Silicon) and `x64` (Intel)
- **macOS ZIP**: Same dual architecture support
- **Category**: `public.app-category.developer-tools`

### Packaging Details

- **asar**: Enabled. The app is bundled into an asar archive for faster loading.
- **asarUnpack**: `dist/*.js`, `dist/cli/**`, and `node_modules/node-pty/**` are unpacked from the asar archive (configured in `electron-builder.yml`).
- **extraResources**: `dist/runtime` (containing `port-hook.cjs`) is copied to the `runtime` resource directory.
- **Included files**: `dist/**/*`, `node_modules/**/*`, `package.json`
- **Output directory**: `release/`

### Build Command

```bash
pnpm build:app   # Runs pnpm build && electron-builder --mac
```

This first builds the entire project (backend, frontend, and Electron sources), then packages it with electron-builder.

## Development

### Dev Mode

The full dev setup runs four concurrent processes:

```bash
pnpm dev
```

This executes:

| Process                | Command                                 | Description                                                                   |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `dev:ui`               | `vite`                                  | Vite dev server for the React UI (port 6969)                                  |
| `dev:backend`          | `tsup ... --watch`                      | Watches and rebuilds CLI and electron-entry                                   |
| `dev:electron:compile` | `tsc -p electron/tsconfig.json --watch` | Watches and compiles Electron TypeScript sources                              |
| `dev:electron:run`     | `electronmon .`                         | Runs Electron with auto-restart, waits for UI dev server and compiled main.js |

In dev mode, the renderer loads from the Vite dev server (`UI_DEV_SERVER_URL=http://localhost:6969`) instead of the built files, enabling hot module replacement. `electronmon` automatically restarts the Electron main process when `dist/electron/main.js` changes.

### Running Electron Standalone

If you only need to test the Electron shell without the full dev pipeline:

```bash
# Build first
pnpm build

# Then launch
electron . --project /path/to/your/project
```

The `--project` flag tells the app to open a specific project directory on startup.

### Window Properties

- **Minimum size**: 800x700
- **Default size**: 1200x900
- **Title bar**: Hidden with inset traffic lights (macOS native style)
- **Traffic light position**: `{ x: 12, y: 12 }`
- **Background color**: `#0a0c10` (matches the app's dark theme)

### TypeScript Configuration

The Electron sources use a separate `tsconfig.json` (`electron/tsconfig.json`) that targets ES2022 with NodeNext module resolution, outputting to `dist/electron/`. The preload script is a plain CommonJS file (`preload.cjs`) that is copied directly to the output directory rather than compiled, since Electron requires preload scripts to be CommonJS.
