import { Logger, initLogger } from "@openkit/logger/browser";

export const log = new Logger("web-app");

// Initialize the WASM logger module asynchronously.
// Log calls before init completes are no-ops; after init the Logger
// re-initializes its Go handle on the next call.
initLogger().then(() => {
  Logger.setSink(window.location.origin, "");
});
