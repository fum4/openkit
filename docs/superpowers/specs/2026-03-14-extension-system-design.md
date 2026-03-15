# Extension System Design Spec

## Problem

OpenKit has built-in integrations for Jira, Linear, and GitHub. Users who need other issue trackers (Asana, ClickUp, Shortcut, Azure DevOps, YouTrack, etc.) or other types of extensions (context sources, custom pages, notification sinks) have no way to add them. The current integration code is also duplicated — Jira and Linear have nearly identical UI components and route patterns but no shared abstraction.

## Goals

1. Enable users to extend OpenKit with custom issue tracker integrations via a well-defined extension API
2. Unify the existing Jira/Linear code into a shared abstraction that extensions also use
3. Design a scalable architecture that can accommodate future extension types (context sources, custom pages, notification sinks, agent tools) without redesigning the core
4. Provide excellent DX for extension authors — typed helpers, clear contracts, good error messages

## Non-Goals (for this design)

- Marketplace / app store (future layer on top of this foundation)
- Extension types beyond issue trackers (architecture supports them, but only issue trackers are implemented now)
- Process isolation / sandboxing (clean API boundary now, isolation can be added later)

---

## Architecture

### Three Layers

**1. `@openkit/extensions` SDK (workspace package at `libs/extensions/`)**
Lives in the monorepo as a pnpm workspace package during development. Published to npm when external extension authors need it. Contains:

- TypeScript types for all event maps, data shapes, and auth configs
- Helper functions: `defineIssueTracker()` (and later `defineContextSource()`, `defineCustomPage()`, etc.)
- Validation utilities

**2. Extension Host (server-side, `apps/server/src/extension-host.ts`)**
Discovers, loads, and manages extensions at runtime:

- Scans global (`~/.openkit/extensions/`) and project (`.openkit/extensions/`) directories
- Clones git repos for remote extensions, caches locally
- Reads manifests, imports entry points, registers event handlers
- Wraps all handler calls in error boundaries (toast on failure, ops log, graceful fallback)
- Manages credential storage per extension

**3. Unified UI (web app)**
Generic, tracker-agnostic components driven by extension data:

- `TrackerIssueList`, `TrackerIssueItem`, `TrackerDetailPanel`, `TrackerSetupForm`
- Dynamic sidebar sections — one per connected tracker
- Component override system — extensions can replace any UI section with custom React components

### Data Flow

```
Web UI → GET /api/trackers/:id/issues → Extension Host → emit('issues:list', { credentials, filters }) → Extension Handler → IssueSummary[] → Unified IssueList
```

All trackers (built-in Jira/Linear + external extensions) use the same generic route set. The `:id` parameter identifies which extension to dispatch to.

---

## Extension Structure

An extension is a git repository with this layout:

```
openkit-ext-example/
  openkit-extension.json    # Manifest (required)
  src/
    index.ts                # Entry point (required)
    components/             # Custom React components (optional)
  package.json              # Dependencies (optional)
  icon.svg                  # Extension icon (optional)
```

### Manifest (`openkit-extension.json`)

```json
{
  "name": "example-tracker",
  "displayName": "Example Tracker",
  "description": "Integration with Example issue tracker",
  "version": "1.0.0",
  "type": "issue-tracker",
  "icon": "./icon.svg",
  "main": "./src/index.ts",
  "auth": {
    "method": "api-key",
    "fields": [
      { "key": "domain", "label": "Domain", "placeholder": "mycompany.example.com" },
      { "key": "email", "label": "Email" },
      { "key": "apiToken", "label": "API Token", "secret": true }
    ]
  },
  "capabilities": ["issues:list", "issues:detail", "issues:update-status", "issues:add-comment"]
}
```

**Manifest fields:**

- `name` — Unique identifier (kebab-case)
- `displayName` — Human-readable name shown in UI
- `type` — Extension type. Currently: `"issue-tracker"`. Future: `"context-source"`, `"custom-page"`, etc.
- `auth.method` — `"api-key"` or `"oauth2"`
- `auth.fields` — For `api-key`: field definitions rendered as a form by OpenKit
- `auth.oauth2` — For `oauth2`: `{ authorizationUrl, tokenUrl, scopes, clientId?, clientSecret? }`. OpenKit handles the browser redirect, token exchange, token refresh, and secure storage. Extensions that need a `cloudId` or `siteUrl` (like Jira) can declare additional fields that the auth flow resolves. If `clientId`/`clientSecret` are not in the manifest, OpenKit prompts the user to provide them.
- `capabilities` — Which optional events this extension supports. Required events must always be implemented.
- `main` — Entry point module path
- `openkitVersion` — (optional) Minimum compatible OpenKit version (e.g., `">=0.1.0"`). Extension Host warns if incompatible.

### Registration in OpenKit Config

**Global** (`~/.openkit/config.json`):

```json
{
  "extensions": [
    { "source": "github:myorg/openkit-ext-asana" },
    { "source": "/Users/me/dev/openkit-ext-custom" }
  ]
}
```

**Per-project** (`.openkit/config.json`):

```json
{
  "extensions": [{ "source": "github:myorg/openkit-ext-shortcut", "enabled": true }],
  "disabledExtensions": ["asana"]
}
```

Sources can be:

- `github:<owner>/<repo>` — cloned/pulled to `~/.openkit/extension-cache/<name>/`
- Absolute local path — resolved directly, ideal for development

---

## Event-Driven Adapter Interface

Extensions use an event-driven pattern. The `defineIssueTracker()` helper provides full type safety while the runtime is event-based.

### Author DX

```typescript
import { defineIssueTracker } from "@openkit/extensions";

export default defineIssueTracker({
  handlers: {
    // Required events
    "auth:test": async ({ credentials }) => {
      const resp = await fetch(`https://${credentials.domain}/api/test`, {
        headers: { Authorization: `Bearer ${credentials.apiToken}` },
      });
      return { valid: resp.ok, message: resp.ok ? undefined : "Invalid credentials" };
    },

    "issues:list": async ({ credentials, filters }) => {
      // Fetch and return normalized IssueSummary[]
    },

    "issues:detail": async ({ credentials, issueKey }) => {
      // Fetch and return normalized IssueDetail
    },

    // Optional events (only implement what's in capabilities)
    "issues:update-status": async ({ credentials, issueKey, statusId }) => {
      // Update issue status
    },
  },
});
```

### Complete Event Map

**Required events** (must be implemented by all issue tracker extensions):

| Event           | Parameters                  | Returns                                | Description                                      |
| --------------- | --------------------------- | -------------------------------------- | ------------------------------------------------ |
| `auth:test`     | `{ credentials }`           | `{ valid: boolean, message?: string }` | Validate that credentials are working            |
| `issues:list`   | `{ credentials, filters? }` | `IssueSummary[]`                       | List issues (typically assigned to current user) |
| `issues:detail` | `{ credentials, issueKey }` | `IssueDetail`                          | Full issue with comments, attachments            |

**Optional events** (declared in `capabilities`):

| Event                         | Parameters                                   | Returns            | Description                                                                            |
| ----------------------------- | -------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `issues:statuses`             | `{ credentials, issueKey? }`                 | `StatusOption[]`   | Available status transitions                                                           |
| `issues:update-status`        | `{ credentials, issueKey, statusId }`        | `void`             | Transition issue status                                                                |
| `issues:priorities`           | `{ credentials }`                            | `PriorityOption[]` | Available priority values                                                              |
| `issues:update-priority`      | `{ credentials, issueKey, priorityId }`      | `void`             | Change priority                                                                        |
| `issues:types`                | `{ credentials, issueKey? }`                 | `TypeOption[]`     | Available issue types                                                                  |
| `issues:update-type`          | `{ credentials, issueKey, typeId }`          | `void`             | Change issue type                                                                      |
| `issues:update-summary`       | `{ credentials, issueKey, summary }`         | `void`             | Edit issue title                                                                       |
| `issues:update-description`   | `{ credentials, issueKey, description }`     | `void`             | Edit issue description (receives markdown, extension converts to native format)        |
| `issues:add-comment`          | `{ credentials, issueKey, body }`            | `Comment`          | Post a comment (markdown input)                                                        |
| `issues:update-comment`       | `{ credentials, issueKey, commentId, body }` | `void`             | Edit existing comment                                                                  |
| `issues:delete-comment`       | `{ credentials, issueKey, commentId }`       | `void`             | Delete a comment                                                                       |
| `issues:download-attachments` | `{ credentials, issueKey, targetDir }`       | `Attachment[]`     | Download issue attachments to local directory                                          |
| `issues:resolve-key`          | `{ partialKey, config }`                     | `string`           | Resolve partial key (e.g., "123") to full key (e.g., "PROJ-123") using default project |

### Normalized Data Types

All extensions map their data to these shared types:

```typescript
interface IssueSummary {
  key: string; // Issue identifier (e.g., "PROJ-123")
  title: string; // Issue title/summary
  status: IssueStatus; // { name, color? }
  priority: IssuePriority; // { name, level?, color? }
  type?: string; // Issue type (e.g., "Bug", "Story")
  assignee?: string; // Display name
  updatedAt: string; // ISO 8601
  labels: IssueLabel[]; // { name, color? }
  url: string; // Web URL to issue in tracker
}

interface IssueDetail extends IssueSummary {
  description: string; // Markdown (extension converts from native format)
  reporter?: string;
  createdAt: string;
  comments: Comment[];
  attachments: Attachment[];
  metadata: Record<string, unknown>; // Extension-specific extra fields
}

interface Comment {
  id: string;
  author: string;
  body: string; // Markdown
  createdAt: string;
  canEdit?: boolean; // Whether current user can edit this comment
}

interface Attachment {
  filename: string; // Display name
  localPath?: string; // Set after download (for file-type attachments)
  mimeType?: string;
  size?: number;
  url?: string; // Remote URL (for download or external link)
  kind: "file" | "link"; // 'file' = downloadable (Jira), 'link' = external URL (Linear)
  sourceType?: string; // Source hint (e.g., "github", "figma" for Linear link attachments)
}

interface IssueStatus {
  name: string;
  color?: string;
}
interface IssuePriority {
  name: string;
  level?: number;
  color?: string;
}
interface IssueLabel {
  name: string;
  color?: string;
}
interface StatusOption {
  id: string;
  name: string;
}
interface PriorityOption {
  id: string;
  name: string;
}
interface TypeOption {
  id: string;
  name: string;
}
```

---

## Component Override System

The unified UI is composed of well-defined sections, each with a default implementation. Extensions can override any section by providing a custom React component.

### Available Sections

**Issue Detail Panel:**
| Section ID | Default Behavior | When to Override |
|-----------|-----------------|------------------|
| `detail:header` | Issue key + title + status badge | Custom workflow visualization |
| `detail:description` | Renders markdown description | Custom rich editor |
| `detail:metadata` | Key-value pairs from `metadata` field | Custom field layout |
| `detail:comments` | Threaded comment list with add/edit/delete | Custom comment format |
| `detail:attachments` | File list with download links | Image gallery, preview |
| `detail:actions` | Buttons based on capabilities (status, priority) | Custom workflow actions |

**Issue List:**
| Section ID | Default Behavior | When to Override |
|-----------|-----------------|------------------|
| `list:item` | Standard row (key, title, status, priority) | Custom card layout |
| `list:filters` | Status/priority/search dropdowns | Custom filter UI |

### How Extensions Declare Overrides

```typescript
export default defineIssueTracker({
  handlers: {
    /* ... */
  },
  components: {
    "detail:description": () => import("./components/CustomDescription"),
    "detail:metadata": () => import("./components/CustomMetadata"),
    // Sections not listed use the default
  },
});
```

Override components receive standardized props (the normalized data types above) plus an `extension` context object with the extension's metadata.

### Rendering Logic

```
For each section in the detail/list UI:
  if extension.components[sectionId] exists → render extension component
  else → render default component with normalized data
```

---

## Extension Host Details

### Discovery & Loading (server startup)

1. Read `extensions` array from global config (`~/.openkit/config.json`)
2. Read `extensions` array from project config (`.openkit/config.json`)
3. Merge: project extensions add to global; `disabledExtensions` excludes by name
4. For each extension source:
   a. If `github:owner/repo` → clone/pull to `~/.openkit/extension-cache/<name>/`
   b. If local path → resolve directly
   c. Read `openkit-extension.json` manifest
   d. Validate manifest (required fields, known type, valid capabilities)
   e. Transpile TypeScript entry point (using esbuild or similar)
   f. Dynamic import the built module
   g. Register event handlers on the extension's event bus
5. Log loaded extensions (info level); toast warnings for invalid/failed extensions

### Built-in Extensions

Jira and Linear are refactored as built-in extensions in `libs/integrations/src/`. They implement the same `IssueTrackerProvider` interface and are registered on the event bus just like external extensions, but they don't need a manifest file or git repo — they're discovered by the Extension Host as "built-in" types.

### Error Handling

Every event handler invocation is wrapped:

```typescript
async function dispatchEvent(extensionId: string, event: string, params: unknown) {
  const handler = extensions.get(extensionId)?.handlers[event];
  if (!handler) {
    throw new ExtensionError(`${extensionId}: handler for '${event}' not implemented`);
  }

  try {
    const result = await Promise.race([
      handler(params),
      timeout(30_000), // 30s timeout for API calls
    ]);
    return result;
  } catch (error) {
    // Toast notification to user
    notifyError(`${manifest.displayName}: Failed to ${eventDescription(event)}`, error);
    // Ops log with full details
    opsLog.error({ extension: extensionId, event, error });
    // Rethrow so the route can return an appropriate error response
    throw error;
  }
}
```

### Credential Management

- Credentials stored in `~/.openkit/integrations.json` under the extension's name key
- Extension Host loads credentials and passes them to event handlers as parameters
- Extensions never access the credential store directly
- For `api-key` auth: OpenKit renders the form from manifest field definitions, stores values
- For `oauth2` auth: OpenKit handles the redirect flow using manifest-provided URLs, stores tokens, handles refresh

---

## Generic Server Routes

Replace per-tracker routes (`routes/jira.ts`, `routes/linear.ts`) with a single `routes/trackers.ts`:

```
GET    /api/trackers                              → List all registered trackers + connection status
GET    /api/trackers/:id/status                   → Auth status for a specific tracker
POST   /api/trackers/:id/setup                    → Store credentials (runs auth:test first)
DELETE /api/trackers/:id/credentials              → Disconnect tracker
PATCH  /api/trackers/:id/config                   → Update tracker settings (refresh interval, data lifecycle, auto-start)

GET    /api/trackers/:id/issues                   → List issues (dispatches issues:list)
GET    /api/trackers/:id/issues/:key              → Issue detail (dispatches issues:detail)
GET    /api/trackers/:id/issues/:key/statuses     → Available statuses (dispatches issues:statuses)
GET    /api/trackers/:id/issues/:key/priorities    → Available priorities (dispatches issues:priorities)
GET    /api/trackers/:id/issues/:key/types        → Available types (dispatches issues:types)

PATCH  /api/trackers/:id/issues/:key/status       → Update status (dispatches issues:update-status)
PATCH  /api/trackers/:id/issues/:key/priority     → Update priority (dispatches issues:update-priority)
PATCH  /api/trackers/:id/issues/:key/type         → Update type (dispatches issues:update-type)
PATCH  /api/trackers/:id/issues/:key/summary      → Update title (dispatches issues:update-summary)
PATCH  /api/trackers/:id/issues/:key/description  → Update description (dispatches issues:update-description)

POST   /api/trackers/:id/issues/:key/comments     → Add comment (dispatches issues:add-comment)
PATCH  /api/trackers/:id/issues/:key/comments/:cid → Edit comment (dispatches issues:update-comment)
DELETE /api/trackers/:id/issues/:key/comments/:cid → Delete comment (dispatches issues:delete-comment)

POST   /api/trackers/:id/task                     → Create worktree from issue

GET    /api/trackers/:id/attachment               → Proxy attachment content (handles auth headers for the tracker)
```

Additionally, global option endpoints (not per-issue) are needed for some trackers:

```
GET    /api/trackers/:id/priorities               → Global priority list (dispatches issues:priorities without issueKey)
GET    /api/trackers/:id/statuses                 → Global status list (dispatches issues:statuses without issueKey)
```

Route handlers check the extension's `capabilities` before dispatching optional events — returns 404 with a clear message if the capability isn't supported.

### Backward Compatibility

During migration, keep `/api/jira/*` and `/api/linear/*` as thin aliases that redirect to `/api/trackers/jira/*` and `/api/trackers/linear/*`. Remove after migration is stable.

---

## CLI Integration

### New Commands

```
dawg ext add <github-url|local-path>    # Register an extension
dawg ext remove <name>                   # Unregister an extension
dawg ext list                            # Show all extensions + status
dawg ext update [name]                   # Pull latest from git remote
```

### Existing Commands

- `dawg add` — The interactive setup wizard discovers all registered trackers (built-in + extensions) and shows them for connection. No per-tracker code needed.
- `dawg task <key>` — Resolves the issue key against all connected trackers. If the key matches a specific tracker's pattern, dispatches to that tracker's `issues:resolve-key` + worktree creation.

---

## Unified UI Changes

### Sidebar

Currently hardcoded Jira/Linear sections. Changes to a dynamic loop over all connected trackers:

- Each tracker gets a collapsible section with its icon and display name
- Issue list within each section uses the generic `TrackerIssueList` component
- Section order configurable by user (drag-and-drop or config)

### Integrations Page

Shows all available trackers (built-in + from extensions):

- Connected trackers: show status, email/domain, settings, disconnect button
- Available trackers: show connect button, renders auth form from manifest
- Extension management: add/remove extensions, show loaded status

### Component File Changes

**Remove (replace with generic):**

- `components/JiraIssueList.tsx` → `components/TrackerIssueList.tsx`
- `components/JiraIssueItem.tsx` → `components/TrackerIssueItem.tsx`
- `components/detail/JiraDetailPanel.tsx` → `components/detail/TrackerDetailPanel.tsx`
- `components/LinearIssueList.tsx` → (merged into `TrackerIssueList.tsx`)
- `components/LinearIssueItem.tsx` → (merged into `TrackerIssueItem.tsx`)
- `components/detail/LinearDetailPanel.tsx` → (merged into `TrackerDetailPanel.tsx`)

**New:**

- `components/TrackerSetupForm.tsx` — Renders auth fields from manifest definition
- `components/TrackerSettingsPanel.tsx` — Per-tracker configuration UI

**Updated:**

- `components/IntegrationsPanel.tsx` — Dynamic, driven by registered trackers instead of hardcoded
- The sidebar component(s) that currently render Jira/Linear issue sections — updated to dynamically loop over connected trackers

### Hooks

**Remove:**

- `useJiraIssues.ts`, `useLinearIssues.ts`

**New:**

- `useTrackerIssues.ts` — Generic hook parameterized by tracker ID
- `useTrackers.ts` — Returns all registered trackers + connection status
- `useTrackerDetail.ts` — Generic issue detail hook

**Updated API functions:**

- Generic `fetchTrackerIssues(trackerId)`, `fetchTrackerDetail(trackerId, key)`, etc.
- All point to `/api/trackers/:id/*` routes

---

## Implementation Phases

### Phase 1: Core Infrastructure

- Define normalized types (`IssueSummary`, `IssueDetail`, etc.) in `@openkit/extensions` or a shared location
- Define the `IssueTrackerEventMap` type and `defineIssueTracker()` helper
- Build the Extension Host (`apps/server/src/extension-host.ts`): discovery, loading, event bus, error handling
- Create generic `/api/trackers/` routes (`apps/server/src/routes/trackers.ts`)
- Refactor Jira integration as a built-in extension implementing the event interface
- Verify: Jira works identically through the new generic routes

### Phase 2: Unified UI

- Build generic components: `TrackerIssueList`, `TrackerDetailPanel`, `TrackerSetupForm`
- Implement the component override system
- Refactor Linear integration as a built-in extension
- Update sidebar to be dynamic (one section per connected tracker)
- Update IntegrationsPanel to be driven by registered trackers
- Remove old duplicated Jira/Linear-specific components and hooks
- Verify: both Jira and Linear work through unified UI

### Phase 3: External Extensions

- Git-based extension loading (clone, cache, transpile)
- CLI commands (`dawg ext add/remove/list/update`)
- Extension management UI in web app
- Build a sample/test extension to validate the full loop
- Verify: can add, connect, and use a third-party issue tracker extension

### Phase 4: Polish & DX

- Validation in `defineIssueTracker()` — clear errors for missing required handlers
- Extension development documentation
- Hot reload for local extensions during development
- `dawg ext create <name>` scaffolding command

---

## Testing Strategy

- **Unit tests:** Each adapter (Jira, Linear) tested against the normalized interface — input raw API response, verify normalized output matches types
- **Extension Host tests:** Loading/discovery, event dispatch, error boundaries, timeout handling, credential isolation
- **Route tests:** Generic tracker routes return correct data for different trackers, handle missing capabilities gracefully
- **UI tests:** Generic components render correctly with data from different tracker shapes; component override system works
- **Integration test:** End-to-end flow with a mock extension — register, connect, list issues, view detail, create worktree

---

## Future Extension Types

The architecture supports future extension types without redesign:

| Type                | Helper                     | Events                            | UI Surface                                  |
| ------------------- | -------------------------- | --------------------------------- | ------------------------------------------- |
| `issue-tracker`     | `defineIssueTracker()`     | `issues:*`, `auth:*`              | Sidebar list, detail panel, integrations    |
| `context-source`    | `defineContextSource()`    | `context:search`, `context:fetch` | Worktree context panel, TASK.md enrichment  |
| `custom-page`       | `defineCustomPage()`       | `page:render`                     | New top-level nav entry, full React page    |
| `notification-sink` | `defineNotificationSink()` | `notify:send`, `notify:config`    | Activity settings, per-event routing        |
| `agent-tool`        | `defineAgentTool()`        | `tool:execute`                    | MCP action registration, agent instructions |

Each type gets its own event map, manifest schema, and helper function. The Extension Host, discovery, loading, and error handling are shared.
