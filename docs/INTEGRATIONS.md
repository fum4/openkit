# Integrations

openkit connects to external issue trackers and source control platforms to create a seamless workflow between issues and worktrees. You can browse issues, create worktrees directly from them, and manage git operations -- all from the web UI or CLI.

Three integrations are available:

- **Jira** -- Atlassian issue tracking with OAuth 2.0 or API token authentication
- **Linear** -- Issue tracking with API key authentication
- **GitHub** -- Git operations and PR management via the `gh` CLI

All integrations are optional and can be configured independently.

---

## Jira Integration

### Authentication

Jira supports two authentication methods. Both are configured per-project and stored in `.openkit/integrations.json`.

#### OAuth 2.0 (Recommended)

OAuth is the primary authentication method. It uses Atlassian's OAuth 2.0 authorization code flow with offline access for automatic token refresh.

**Prerequisites:**

1. Create an OAuth 2.0 app at [developer.atlassian.com/console](https://developer.atlassian.com/console)
2. Note your Client ID and Client Secret

**How the flow works:**

1. OpenKit starts an ephemeral HTTP server on a random port (e.g., `http://localhost:54321/callback`)
2. It opens the Atlassian authorization URL in your browser with the scopes `read:jira-work` and `offline_access`
3. After you authorize, Atlassian redirects to the local callback URL with an authorization code
4. OpenKit exchanges the code for an access token, refresh token, and expiration time
5. OpenKit calls the Atlassian accessible-resources API to discover the `cloudId` and site URL for your Jira instance (if multiple sites are found, it uses the first one)
6. Credentials are saved to `.openkit/integrations.json`

**Token refresh:** Before every API call, OpenKit checks if the access token expires within 60 seconds. If so, it automatically refreshes using the refresh token and persists the new credentials to disk. This is transparent to the user.

**OAuth flow timeout:** The local callback server times out after 5 minutes.

**Stored fields (OAuth):**

```
authMethod: "oauth"
oauth.clientId
oauth.clientSecret
oauth.accessToken
oauth.refreshToken
oauth.expiresAt       (epoch milliseconds)
oauth.cloudId
oauth.siteUrl
```

#### API Token Fallback

For environments where OAuth app registration is impractical (e.g., restricted Atlassian orgs), you can use a personal API token instead.

**Prerequisites:**

1. Create an API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Know your Jira site URL (e.g., `https://your-org.atlassian.net`)

**Stored fields (API Token):**

```
authMethod: "api-token"
apiToken.baseUrl      (e.g., "https://your-org.atlassian.net")
apiToken.email
apiToken.token
```

Authentication headers differ by method:

- **OAuth**: `Authorization: Bearer <accessToken>`
- **API Token**: `Authorization: Basic <base64(email:token)>`

Both methods are validated with a `GET /rest/api/3/myself` call before credentials are saved.

### API Base URL

The REST API base varies by auth method:

- **OAuth**: `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3`
- **API Token**: `{baseUrl}/rest/api/3`

### Issue Fetching

**Issue list** (`GET /api/jira/issues`):

Uses JQL to fetch unresolved issues assigned to the current user, ordered by last update:

```
assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC
```

When a `query` parameter is provided, a text search filter is added:

```
assignee = currentUser() AND resolution = Unresolved AND text ~ "query" ORDER BY updated DESC
```

Fields fetched for the list: `summary`, `status`, `priority`, `issuetype`, `assignee`, `updated`, `labels`. Maximum 50 results.

**Issue detail** (`GET /api/jira/issues/:key`):

Fetches the full issue with `expand=renderedFields`, plus comments (up to 50, newest first). The response includes:

| Field         | Description                            |
| ------------- | -------------------------------------- |
| `key`         | Issue key (e.g., `PROJ-123`)           |
| `summary`     | Issue title                            |
| `description` | Converted from ADF to Markdown         |
| `status`      | Current status name                    |
| `priority`    | Priority name                          |
| `type`        | Issue type name                        |
| `assignee`    | Display name or null                   |
| `reporter`    | Display name or null                   |
| `labels`      | Array of label strings                 |
| `comments`    | Array of `{ author, body, created }`   |
| `attachments` | Array of attachment metadata           |
| `url`         | Direct link to the issue in Jira       |
| `fetchedAt`   | ISO timestamp of when data was fetched |

**Issue key resolution:** If a user provides just a number (e.g., `123`), OpenKit prepends the configured `defaultProjectKey` to form the full key (e.g., `PROJ-123`). If no default is set, the user must provide the full key.

### ADF-to-Markdown Conversion

Jira stores rich text in Atlassian Document Format (ADF), a JSON-based document structure. OpenKit converts ADF to Markdown for rendering in the UI. Supported node types:

- **Block-level**: `paragraph`, `heading` (levels 1-6), `codeBlock` (with language), `blockquote`, `bulletList`, `orderedList`, `rule`
- **Inline**: `text` with marks (`strong`, `em`, `code`, `strike`, `link`), `mention`, `inlineCard`, `hardBreak`
- **Media**: `mediaSingle`, `mediaGroup`, `media` -- images render as `![name](url)`, other files as `[name](url)`

Attachments referenced in ADF media nodes are resolved via an attachment map keyed by filename and ID. Image URLs are rewritten to go through OpenKit's attachment proxy (`/api/jira/attachment?url=...`), which adds the necessary auth headers.

### Attachments

**Proxy endpoint** (`GET /api/jira/attachment`):

Since Jira attachment URLs require authentication, OpenKit provides a proxy that fetches the attachment with the stored credentials and streams it to the client. Responses are cached for 1 hour (`Cache-Control: private, max-age=3600`).

**Download to disk:**

When `saveOn` is set to `"view"`, attachments are downloaded to `.openkit/issues/jira/{KEY}/attachments/` in the background after fetching issue detail. Duplicate filenames are handled by appending a counter suffix (e.g., `image_1.png`). Downloaded attachment paths are written back into the issue's `issue.json`.

### Data Lifecycle

The data lifecycle system controls when issue data is persisted to disk and when it gets cleaned up. Configuration is stored per-integration in `integrations.json` under the `dataLifecycle` key.

**`saveOn`** -- Controls when issue data is written to disk:

| Value                 | Behavior                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `"view"`              | Save issue data, comments, and attachments when the issue is opened in the detail panel. **(Default)** |
| `"worktree-creation"` | Only save when a worktree is created from the issue.                                                   |
| `"never"`             | Never save issue data to disk. Disables auto-cleanup.                                                  |

**`autoCleanup`** -- Automatically deletes cached data when an issue transitions to certain statuses:

| Field                    | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `enabled`                | Boolean toggle                                                          |
| `statusTriggers`         | Array of status names that trigger cleanup (e.g., `["Done", "Closed"]`) |
| `actions.issueData`      | Delete cached `issue.json`                                              |
| `actions.attachments`    | Delete downloaded attachments                                           |
| `actions.notes`          | Delete personal notes and AI context                                    |
| `actions.linkedWorktree` | Unlink/delete the associated worktree                                   |

Auto-cleanup runs as a fire-and-forget operation whenever the issue list is fetched. It compares each cached issue directory against the live status (or falls back to the cached status in `issue.json`) and cleans up issues whose status matches a trigger.

### Configuration

| Setting                          | Description                                                                                        | Default                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `defaultProjectKey`              | Project key prefix for short issue IDs (e.g., `"PROJ"`)                                            | none                               |
| `refreshIntervalMinutes`         | How often to poll for issue list updates                                                           | `5`                                |
| `dataLifecycle`                  | Data persistence and cleanup settings                                                              | `saveOn: "view"`, cleanup disabled |
| `autoStartAgent`                 | Which coding agent to auto-start (`claude`, `codex`, `gemini`, `opencode`)                         | `claude`                           |
| `autoStartClaudeOnNewIssue`      | Automatically create/open a worktree and start the selected agent when newly fetched issues appear | `false`                            |
| `autoStartClaudeSkipPermissions` | Run auto-started agent with skip-permissions enabled                                               | `true`                             |
| `autoStartClaudeFocusTerminal`   | Redirect UI to the selected agent terminal when auto-start begins                                  | `true`                             |

---

## Linear Integration

### Authentication

Linear uses API key authentication. There is no OAuth flow.

**Prerequisites:**

1. Create a personal API key at [linear.app/settings/account/security/api-keys/new](https://linear.app/settings/account/security/api-keys/new)

The API key is sent directly in the `Authorization` header (no `Bearer` prefix). On setup, OpenKit validates the key by querying the `viewer` field and stores the user's display name alongside the key.

**Stored fields:**

```
apiKey       (the Linear personal API key)
displayName  (fetched automatically on connection)
```

### GraphQL Queries

Linear's API is GraphQL-only, accessed at `https://api.linear.app/graphql`. OpenKit uses the following queries:

**Connection test:**

```graphql
query {
  viewer {
    id
    name
    email
  }
}
```

**Issue list** (`fetchIssues`):

Fetches up to 50 uncompleted, uncanceled issues assigned to the current user, ordered by `updatedAt`. Optionally filtered by team key and/or a text search query.

Fields: `identifier`, `title`, `state { name type color }`, `priority`, `assignee { name }`, `updatedAt`, `labels { name color }`, `url`.

When a `query` parameter is provided, the `issueSearch` query is used instead of `issues`, enabling full-text search within the filtered set.

**Issue detail** (`fetchIssue`):

Parses the identifier (e.g., `ENG-123`) into team key and issue number, then fetches:

- Full issue data including `description` (Markdown)
- Up to 50 comments, ordered by creation date
- Up to 50 attachments with `title`, `subtitle`, `url`, and `sourceType`

### Issue Identifier Resolution

Same pattern as Jira: if a user provides just a number (e.g., `123`), OpenKit prepends the configured `defaultTeamKey` (e.g., `ENG-123`). If no default is set, the full identifier must be provided.

### State Types

Linear issues have a `state` object with `name`, `type`, and `color` fields. The `type` field maps to one of Linear's built-in state categories:

| Type        | Meaning        |
| ----------- | -------------- |
| `triage`    | Needs triage   |
| `backlog`   | In backlog     |
| `unstarted` | Ready to start |
| `started`   | In progress    |
| `completed` | Done           |
| `canceled`  | Canceled       |

OpenKit uses the `type` field for auto-cleanup triggers. Issues with `completedAt` or `canceledAt` set are excluded from the default list fetch.

### Configuration

| Setting                          | Description                                                                                        | Default                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `defaultTeamKey`                 | Team key prefix for short identifiers (e.g., `"ENG"`)                                              | none                               |
| `refreshIntervalMinutes`         | How often to poll for issue list updates                                                           | `5`                                |
| `dataLifecycle`                  | Data persistence and cleanup settings (same structure as Jira)                                     | `saveOn: "view"`, cleanup disabled |
| `autoStartAgent`                 | Which coding agent to auto-start (`claude`, `codex`, `gemini`, `opencode`)                         | `claude`                           |
| `autoStartClaudeOnNewIssue`      | Automatically create/open a worktree and start the selected agent when newly fetched issues appear | `false`                            |
| `autoStartClaudeSkipPermissions` | Run auto-started agent with skip-permissions enabled                                               | `true`                             |
| `autoStartClaudeFocusTerminal`   | Redirect UI to the selected agent terminal when auto-start begins                                  | `true`                             |

---

## GitHub Integration

### Dependency

GitHub integration requires the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed and authenticated. OpenKit does **not** store any GitHub credentials itself; it delegates entirely to `gh`.

OpenKit checks for `gh` availability in two steps:

1. `which gh` -- Is the CLI installed?
2. `gh auth status` -- Is the user authenticated?

On macOS desktop launches, OpenKit ensures common Homebrew bin directories are present in `PATH` (`/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`) so `gh`/`brew` can be discovered even when the app is started outside a shell.

If both pass, OpenKit queries repo info via `gh repo view --json nameWithOwner,defaultBranchRef` to determine the owner, repo name, and default branch.

### Installation and Authentication

**Via the web UI:**

The Integrations panel first checks whether `gh` is already available. If not, it can install `gh` automatically using `brew install gh` (macOS only). After installation, it initiates the GitHub device flow (`gh auth login --web`) with the `user` scope, parses the one-time code from stderr, opens the browser, and copies the code to the clipboard.

After successful authentication, OpenKit automatically:

1. Runs `gh auth setup-git` to configure `gh` as the git credential helper
2. Configures local `git user.name` and `git user.email` from the authenticated GitHub account

**Via the CLI:**

```bash
# Check status
openkit add github

# Or manually
gh auth login
```

### Git Operations

The `GitHubManager` class manages all git operations and maintains two caches:

**Git status cache** (polled every 10 seconds):

| Field            | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `hasUncommitted` | Worktree has uncommitted changes (`git status --porcelain`) |
| `ahead`          | Commits ahead of upstream                                   |
| `behind`         | Commits behind upstream                                     |
| `noUpstream`     | No upstream branch configured                               |
| `aheadOfBase`    | Commits ahead of the base branch (for PR eligibility)       |

**PR cache** (polled every 60 seconds):

For each worktree, queries the GitHub API for PRs matching the branch: `repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all`. Tracks PR URL, number, state (`open`/`closed`/`merged`), draft status, and title.

### Commit, Push, and PR Creation

**Commit** (`POST /api/worktrees/:id/commit`):

Runs `git add -A && git commit -m "message"` in the worktree directory.

**Push** (`POST /api/worktrees/:id/push`):

Runs `git push --set-upstream origin HEAD` in the worktree directory. After a successful push, both the git status and PR caches are refreshed for that worktree.

**Create PR** (`POST /api/worktrees/:id/create-pr`):

Runs `gh pr create --title "..." --body "..." --base <defaultBranch>` in the worktree directory. The base branch defaults to the repository's default branch (typically `main`). Returns the PR URL, number, and metadata.

### Repository Setup

For projects without a GitHub remote, OpenKit provides a setup flow that can:

1. **Create an initial commit** -- `git add -A && git commit -m "Initial commit"`
2. **Create a GitHub repository** -- `gh repo create --source . --private --push` (or `--public`)
3. **Link an existing repository** -- If a repo with the same name already exists, falls back to adding the remote and pushing

### Status Endpoint

`GET /api/github/status` returns:

```json
{
  "installed": true,
  "authenticated": true,
  "username": "octocat",
  "repo": "org/repo-name",
  "hasRemote": true,
  "hasCommits": true
}
```

---

## Configuration Methods

### Web UI (Integrations Panel)

Navigate to the **Integrations** view in the OpenKit UI. Each integration has a dedicated card:

- **GitHub**: Shows CLI/auth/repo status. Can install `gh`, trigger login, create repos.
- **Jira**: API token setup form (base URL, email, token). After connecting: project key, refresh interval, and data lifecycle settings with auto-save.
- **Linear**: API key setup form. After connecting: team key, refresh interval, and data lifecycle settings with auto-save.

Both Jira and Linear cards include an `Auto-start agent` section. You first choose one agent (`Claude`, `Codex`, `Gemini`, or `OpenCode`), then configure the existing toggles. When auto-start is enabled, OpenKit watches freshly fetched issue lists and, for newly discovered issues, creates (or reuses) the issue worktree, starts the selected agent terminal session using the standard TASK.md-first workflow, and records activity feed events for both task detection and auto-start. Additional toggles control whether the selected agent runs with skip-permissions mode and whether the UI auto-focuses the selected agent terminal as soon as work begins.

Configuration changes in the UI are auto-saved with a 300ms debounce.

### CLI (`openkit add`)

```bash
# Interactive picker
openkit add

# Direct setup
openkit add github
openkit add jira
openkit add linear
```

The `openkit add` command provides an interactive setup flow:

- **GitHub**: Checks `gh` installation and auth status, displays repo info.
- **Jira**: Prompts for OAuth or API token auth method, runs the appropriate setup flow, and asks for an optional default project key.
- **Linear**: Prompts for an API key, validates it, and asks for an optional default team key.

---

## Data Storage

All integration data lives under the `.openkit/` configuration directory.

### Credentials

Stored in `.openkit/integrations.json`:

```json
{
  "jira": {
    "authMethod": "oauth",
    "oauth": { "clientId": "...", "accessToken": "...", "...": "..." },
    "defaultProjectKey": "PROJ",
    "refreshIntervalMinutes": 5,
    "dataLifecycle": { "...": "..." },
    "autoStartAgent": "claude",
    "autoStartClaudeOnNewIssue": false,
    "autoStartClaudeSkipPermissions": true,
    "autoStartClaudeFocusTerminal": true
  },
  "linear": {
    "apiKey": "lin_api_...",
    "displayName": "Jane Developer",
    "defaultTeamKey": "ENG",
    "refreshIntervalMinutes": 5,
    "dataLifecycle": { "...": "..." },
    "autoStartAgent": "claude",
    "autoStartClaudeOnNewIssue": false,
    "autoStartClaudeSkipPermissions": true,
    "autoStartClaudeFocusTerminal": true
  }
}
```

This file contains secrets and **must be gitignored**. GitHub credentials are not stored here; they live in `gh`'s own credential store.

### Cached Issue Data

Issue data is saved to disk under `.openkit/issues/` with the following structure:

```
.openkit/issues/
  jira/
    PROJ-123/
      issue.json          # Full issue data (description, comments, etc.)
      notes.json          # Personal notes, AI context, linked worktree ID
      attachments/        # Downloaded attachment files
        screenshot.png
        design_spec.pdf
  linear/
    ENG-456/
      issue.json          # Full issue data
      notes.json          # Personal notes, AI context, linked worktree ID
  local/
    LOCAL-1/
      task.json           # Local issue data
      attachments/        # Any attached files
```

Each `notes.json` is initialized with:

```json
{
  "linkedWorktreeId": null,
  "personal": null,
  "aiContext": null
}
```

### Worktree Creation from Issues

When creating a worktree from an issue (`POST /api/jira/task` or `POST /api/linear/task`), the issue data is always saved to disk regardless of the `saveOn` setting. The branch name defaults to the issue key (e.g., `PROJ-123`), but can be overridden.

---

## REST API Reference

### Jira Endpoints

| Method   | Path                    | Description                                                                          |
| -------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `GET`    | `/api/jira/status`      | Connection status, config, and data lifecycle settings                               |
| `POST`   | `/api/jira/setup`       | Connect with API token (`{ baseUrl, email, token }`)                                 |
| `PATCH`  | `/api/jira/config`      | Update project key, refresh interval, lifecycle config, and auto-start agent options |
| `DELETE` | `/api/jira/credentials` | Disconnect (removes jira key from integrations.json)                                 |
| `GET`    | `/api/jira/issues`      | List assigned unresolved issues (optional `?query=` for search)                      |
| `GET`    | `/api/jira/issues/:key` | Fetch full issue detail                                                              |
| `GET`    | `/api/jira/attachment`  | Proxy an attachment URL with auth (`?url=`)                                          |
| `POST`   | `/api/jira/task`        | Create worktree from issue (`{ issueKey, branch? }`)                                 |

### Linear Endpoints

| Method   | Path                             | Description                                                                       |
| -------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `GET`    | `/api/linear/status`             | Connection status, config, and data lifecycle settings                            |
| `POST`   | `/api/linear/setup`              | Connect with API key (`{ apiKey }`)                                               |
| `PATCH`  | `/api/linear/config`             | Update team key, refresh interval, lifecycle config, and auto-start agent options |
| `DELETE` | `/api/linear/credentials`        | Disconnect (removes linear key from integrations.json)                            |
| `GET`    | `/api/linear/issues`             | List assigned active issues (optional `?query=` for search)                       |
| `GET`    | `/api/linear/issues/:identifier` | Fetch full issue detail                                                           |
| `POST`   | `/api/linear/task`               | Create worktree from issue (`{ identifier, branch? }`)                            |

### GitHub Endpoints

| Method | Path                           | Description                                        |
| ------ | ------------------------------ | -------------------------------------------------- |
| `GET`  | `/api/github/status`           | CLI installation, auth, and repo status            |
| `POST` | `/api/github/install`          | Install `gh` via Homebrew and start login          |
| `POST` | `/api/github/login`            | Start GitHub device flow login                     |
| `POST` | `/api/github/logout`           | Logout from GitHub                                 |
| `POST` | `/api/github/initial-commit`   | Create initial git commit                          |
| `POST` | `/api/github/create-repo`      | Create GitHub repository (`{ private?: boolean }`) |
| `POST` | `/api/worktrees/:id/commit`    | Commit all changes (`{ message }`)                 |
| `POST` | `/api/worktrees/:id/push`      | Push branch to origin                              |
| `POST` | `/api/worktrees/:id/create-pr` | Create pull request (`{ title, body? }`)           |
