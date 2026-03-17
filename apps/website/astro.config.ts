import { defineConfig } from "astro/config";
import { SITE_URL } from "@openkit/shared/constants";

export default defineConfig({
  site: SITE_URL,
  build: {
    inlineStylesheets: "always",
  },
});
