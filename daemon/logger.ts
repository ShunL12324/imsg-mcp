import { appendFileSync } from "fs";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ANSI colors — disabled when not a TTY
const isTTY = process.stdout.isTTY ?? false;
const C = {
  reset:  isTTY ? "\x1b[0m"  : "",
  dim:    isTTY ? "\x1b[2m"  : "",
  cyan:   isTTY ? "\x1b[36m" : "",
  green:  isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  red:    isTTY ? "\x1b[31m" : "",
};

const LEVEL_COLOR: Record<Level, string> = {
  debug: C.dim,
  info:  C.green,
  warn:  C.yellow,
  error: C.red,
};

let minLevel: Level = "info";
let logFilePath: string | null = null;

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function write(level: Level, msg: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  const ts = `${C.dim}[${timestamp()}]${C.reset}`;
  const lv = `${LEVEL_COLOR[level]}[${level.toUpperCase().padEnd(5)}]${C.reset}`;
  const line = `${ts} ${lv} ${msg}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  // Also append to file if set (plain text, no ANSI)
  if (logFilePath) {
    const plain = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] ${msg}\n`;
    try { appendFileSync(logFilePath, plain); } catch { /* ignore write errors */ }
  }
}

export const log = {
  debug: (msg: string) => write("debug", msg),
  info:  (msg: string) => write("info",  msg),
  warn:  (msg: string) => write("warn",  msg),
  error: (msg: string) => write("error", msg),
  setLevel:   (level: Level)    => { minLevel = level; },
  setLogFile: (path: string)    => { logFilePath = path; },
};
