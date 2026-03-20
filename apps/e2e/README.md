# @openkit/e2e

End-to-end test suite for OpenKit using Playwright with Electron support.

## Technologies

- **Playwright** — browser/Electron automation and assertions
- **Electron** — tests launch the real desktop app binary

## Usage

```bash
# Run all e2e tests (builds desktop-app first via Nx dependency)
pnpm e2e

# Interactive debugging with Playwright UI
pnpm nx run e2e:e2e:ui

# View last test report
cd apps/e2e && pnpm e2e:report
```

## Structure

- `src/fixtures/` — Reusable Playwright fixtures (Electron launch, temp project creation)
- `src/__test__/` — Test files

## Notes

- Tests use `__WM_PORT_OFFSET__=900` to isolate the Electron instance from any running dev instance.
- Only one Electron instance runs at a time (`workers: 1`).
- No `playwright install` needed — tests use the Electron binary, not Chromium/Firefox/WebKit.
