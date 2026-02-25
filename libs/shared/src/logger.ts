import pc from "picocolors";

export const log = {
  info: (msg: string, ...args: unknown[]) => console.log(msg, ...args),
  success: (msg: string, ...args: unknown[]) => console.log(`${pc.green("●")} ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) =>
    console.warn(`${pc.yellow("⚠")} ${pc.yellow(msg)}`, ...args),
  error: (msg: string, ...args: unknown[]) =>
    console.error(`${pc.red("✖")} ${pc.red(msg)}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) console.log(pc.dim(msg), ...args);
  },
  plain: (msg: string, ...args: unknown[]) => console.log(msg, ...args),
};
