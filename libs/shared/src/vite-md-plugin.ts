/**
 * Vite/Vitest plugin that imports `.md` files as raw text strings.
 * Use in vitest configs when tests transitively import markdown
 * (e.g. via barrel exports from @openkit/agents).
 */

export function mdRawPlugin() {
  return {
    name: "md-raw-loader",
    transform(code: string, id: string) {
      if (id.endsWith(".md")) {
        return { code: `export default ${JSON.stringify(code)}`, map: null };
      }
    },
  };
}
