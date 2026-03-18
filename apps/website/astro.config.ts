import { defineConfig } from "astro/config";
import { SITE_URL } from "./src/constants";

export default defineConfig({
  site: SITE_URL,
  build: {
    inlineStylesheets: "always",
  },
});
