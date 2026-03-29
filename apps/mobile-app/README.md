# @openkit/mobile-app

React Native / Expo mobile app for OpenKit. Provides QR code scanning for quick project pairing on iOS, Android, and web.

## Development

```bash
pnpm dev:mobile-app          # Start Expo dev server
pnpm nx run mobile-app:prebuild  # Generate native projects
```

## Build Scripts

Local EAS builds via `scripts/local-eas-build.ts`:

```bash
pnpm nx run mobile-app:ios-dev-simulator   # iOS simulator (development)
pnpm nx run mobile-app:android-dev         # Android (development)
pnpm nx run mobile-app:ios-preview         # iOS (preview)
pnpm nx run mobile-app:ios-prod            # iOS (production)
```

Remote EAS builds:

```bash
pnpm nx run mobile-app:eas-build-dev       # Development
pnpm nx run mobile-app:eas-build-staging   # Staging (auto-submit)
pnpm nx run mobile-app:eas-build-prod      # Production (auto-submit)
```

## Key Configuration

- **Bundle ID**: `io.nomadware.openkit` (iOS & Android)
- **EAS Project**: `99fe7c99-89fe-40b2-b463-30ca2e1e1cb5`
- **App scheme**: `openkit://`
- **Runtime version policy**: `fingerprint` (OTA updates via EAS Update)
