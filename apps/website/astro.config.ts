import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "../../libs/shared/src/constants";

export default defineConfig({
  site: SITE_URL,
  build: {
    inlineStylesheets: "always",
  },
  vite: {
    resolve: {
      alias: {
        "@openkit/shared": fileURLToPath(new URL("../../libs/shared/src", import.meta.url)),
      },
    },
  },
});
