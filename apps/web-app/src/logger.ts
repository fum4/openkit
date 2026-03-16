import { Logger, initLogger } from "@openkit/logger/browser";

export const log = new Logger("web-app");

if (import.meta.env.MODE !== "test") {
  initLogger().then(() => {
    Logger.setSink(window.location.origin, "");
  });
}
