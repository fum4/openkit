# Setup Flow

## Overview

When a project is opened for the first time (no `.openkit/config.json` exists), OpenKit presents a multi-step setup wizard. The wizard guides users through project configuration, agent skill setup, git setup, and integration linking before dropping them into the main workspace.

The setup flow is implemented in `apps/web-app/src/components/ProjectSetupScreen.tsx` as a single component with a `SetupMode` state machine.

---

## Flow Diagram

```mermaid
flowchart LR
    A["Choice"] --> B["Manual Setup"]
    A -->|auto-detect| C["Agents"]
    B --> C
    C --> D["Commit & Push"]
    D --> E["Integrations"]
    E --> F["Complete"]
    F --> G["Workspace"]

    style A fill:#1a1e25,stroke:#2dd4bf,color:#f0f2f5
    style B fill:#1a1e25,stroke:#9ca3af,color:#f0f2f5
    style C fill:#1a1e25,stroke:#a78bfa,color:#f0f2f5
    style D fill:#1a1e25,stroke:#2dd4bf,color:#f0f2f5
    style E fill:#1a1e25,stroke:#60a5fa,color:#f0f2f5
    style F fill:#1a1e25,stroke:#34d399,color:#f0f2f5
    style G fill:#1a1e25,stroke:#f0f2f5,color:#f0f2f5
```

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> choice
    choice --> manual : "Manual setup" clicked
    choice --> agents : "Auto-detect" clicked (config created)
    manual --> agents : config initialized
    manual --> choice : "Back" clicked
    agents --> choice : "Back" clicked
    agents --> commit_prompt : agents connected or skipped
    commit_prompt --> agents : "Back" clicked
    commit_prompt --> integrations : committed or skipped
    integrations --> commit_prompt : "Back" clicked
    integrations --> getting_started : "Continue" clicked
    getting_started --> integrations : "Back" clicked
    getting_started --> [*] : "Go to workspace"
```

---

## Steps

### 1. Choice (`choice`)

**Purpose:** Let the user choose between automatic and manual configuration.

| Element         | Description                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-detect     | Detects package manager, start/install commands, and base branch from the project. Creates config immediately and advances to Agents. |
| Manual setup    | Opens the manual config form.                                                                                                         |
| Remember choice | Optional checkbox that persists the preference for future projects (Electron only).                                                   |

On mount, the component calls `api.detectConfig()` to pre-fill detected values shown under the auto-detect option.
During setup, config initialization is called with `force: true` so restarting the flow can overwrite an existing `.openkit/config.json`.
Config initialization also auto-enables the default `work-on-task` project skill.

### 2. Manual Setup (`manual`)

**Purpose:** Let the user review and customize detected settings.

**Core fields:**

- Base branch (e.g., `origin/main`)
- Start command (e.g., `pnpm dev`)
- Install command (e.g., `pnpm install`)

**Advanced fields** (behind "Show all options" toggle):

- Project directory (subdirectory for running commands)
- Local issue prefix (e.g., `LOCAL`)
- Auto-install dependencies toggle

Submitting calls `api.initConfig()` and advances to Agents.

### 3. Agents (`agents`)

**Purpose:** Enable the bundled `work-on-task` skill for supported AI coding agents (Claude Code, OpenAI Codex, Cursor, Gemini CLI, VS Code).

Each agent shows **Global** and **Project** scope toggles. The user selects where to enable the skill, then clicks "Connect Agents" to apply. Calls `api.deploySkill("work-on-task", ...)` / `api.undeploySkill("work-on-task", ...)` for each change.

Can be skipped with "Skip for now".

### 4. Commit & Push (`commit-prompt`)

**Purpose:** Commit and push the `.openkit/config.json` and `.openkit/.gitignore` files so the config is available in all worktrees.

Handles three GitHub CLI states:

- **Not installed** -- offers to install via Homebrew with device-flow auth
- **Installed but not authenticated** -- starts device-flow login
- **Ready** -- shows files to commit and an editable commit message

Polls every 2 seconds during device-flow authentication. Can be skipped.

### 5. Integrations (`integrations`)

**Purpose:** Connect external services inline during setup. Shows expandable cards for GitHub, Jira, and Linear.

```mermaid
flowchart TB
    subgraph Integrations Screen
        GH["GitHub Card"]
        JI["Jira Card"]
        LI["Linear Card"]
    end

    GH -->|expand| GH_SETUP["Install CLI / Authenticate"]
    JI -->|expand| JI_SETUP["Base URL + Email + API Token"]
    LI -->|expand| LI_SETUP["API Key"]

    GH_SETUP -->|success| GH_OK["✓ Connected"]
    JI_SETUP -->|success| JI_OK["✓ Connected"]
    LI_SETUP -->|success| LI_OK["✓ Connected"]
```

**Card behavior:**

- Each card shows name, icon, description, and connection status.
- Clicking a card expands it to reveal the inline setup form.
- Only one card can be expanded at a time.
- Connected cards show a green checkmark and connected account info.

**GitHub setup** mirrors the commit-prompt step's GitHub CLI handling (install, auth, device-flow polling).

**Jira setup** collects base URL, email, and API token. Includes a "Create" link to Atlassian's API token page.

**Linear setup** collects an API key. Includes a "Create" link to Linear's API key page.

The "Continue" button advances regardless of how many (or few) integrations are connected. A note reminds users they can always connect later from the Integrations panel.

### 6. Complete (`getting-started`)

**Purpose:** Confirm setup is done and transition to the workspace.

Shows a success message with a summary of connected integrations (as colored pills) and a single "Go to workspace" button.

---

## Component Architecture

```mermaid
flowchart TB
    App["App.tsx"] -->|needsSetup=true| PSS["ProjectSetupScreen"]
    PSS -->|mode state| CHOICE["Choice view"]
    PSS -->|mode state| MANUAL["Manual view"]
    PSS -->|mode state| AGENTS["Agents view"]
    PSS -->|mode state| COMMIT["Commit view"]
    PSS -->|mode state| INTEG["Integrations view"]
    PSS -->|mode state| DONE["Complete view"]

    PSS -->|api calls| API["useApi hook"]
    PSS -->|status fetch| FETCH["fetchGitHubStatus\nfetchJiraStatus\nfetchLinearStatus"]

    DONE -->|onSetupComplete| App
```

All six views are rendered by `ProjectSetupScreen` based on the `mode` state variable. There are no sub-components -- each view is an inline conditional return.

---

## Props

```typescript
interface ProjectSetupScreenProps {
  projectName: string | null; // displayed in the header
  onSetupComplete: () => void; // called when user finishes setup
  onRememberChoice?: (choice: "auto" | "manual") => void; // Electron: persist preference
}
```

---

## API Endpoints Used

| Step            | Endpoint                            | Purpose                         |
| --------------- | ----------------------------------- | ------------------------------- |
| Choice / Manual | `GET /api/config/detect`            | Detect config values            |
| Choice / Manual | `POST /api/config/init`             | Create config                   |
| Agents          | `GET /api/skills/deployment-status` | Current skill deployment status |
| Agents          | `POST /api/skills/:name/deploy`     | Enable skill for agent scope    |
| Agents          | `POST /api/skills/:name/undeploy`   | Disable skill for agent scope   |
| Commit          | `GET /api/github/status`            | GitHub CLI/auth status          |
| Commit          | `POST /api/github/install`          | Install gh CLI + start auth     |
| Commit          | `POST /api/github/login`            | Start device-flow login         |
| Commit          | `POST /api/config/commit-setup`     | Commit & push .openkit files    |
| Integrations    | `GET /api/github/status`            | GitHub status                   |
| Integrations    | `GET /api/jira/status`              | Jira connection status          |
| Integrations    | `GET /api/linear/status`            | Linear connection status        |
| Integrations    | `POST /api/jira/setup`              | Connect Jira                    |
| Integrations    | `POST /api/linear/setup`            | Connect Linear                  |

---

## Skip Behavior

Every step after Choice can be skipped:

| Step         | Skip action                     | What happens             |
| ------------ | ------------------------------- | ------------------------ |
| Agents       | "Skip for now"                  | Advances to Commit       |
| Commit       | "Skip for now"                  | Advances to Integrations |
| Integrations | "Continue without integrations" | Advances to Complete     |

Skipped steps can always be completed later from the corresponding panel in the main workspace (Integrations panel, Agents tab in Configuration, etc.).

---

## Back Navigation

All setup screens after Choice include a Back action.

| Step         | Back target  |
| ------------ | ------------ |
| Manual       | Choice       |
| Agents       | Choice       |
| Commit       | Agents       |
| Integrations | Commit       |
| Complete     | Integrations |
