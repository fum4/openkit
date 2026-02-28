import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://openkit.dev",
  output: "server",
  adapter: vercel(),
});
