import chokidar from "chokidar";
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { log } from "./logger.ts";
import { QUERY, APPLE_EPOCH_OFFSET, resolveText } from "./chat-db.ts";
import type { MessageRow } from "./chat-db.ts";

const CHAT_DB = join(homedir(), "Library/Messages/chat.db");
const MESSAGES_DIR = join(homedir(), "Library/Messages");
const DEBOUNCE_MS = 500;

function fetchNewMessages(lastRowid: number): MessageRow[] {
  const db = new Database(CHAT_DB, { readonly: true });
  try {
    return db.query<MessageRow, [number]>(QUERY).all(lastRowid);
  } finally {
    db.close();
  }
}

function formatTimestamp(appleDate: number): string {
  const unix = Math.floor(appleDate / 1e9) + APPLE_EPOCH_OFFSET;
  return new Date(unix * 1000).toLocaleString();
}

function printMessage(row: MessageRow): void {
  const direction = row.is_from_me ? "→ sent" : "← recv";
  const who = row.is_from_me ? "me" : (row.sender ?? "unknown");
  const chat = row.chat_identifier ?? "unknown";
  const text = resolveText(row) ?? "(no text — attachment or reaction)";
  log.info(`${direction}  ${who}  →  ${chat}`);
  log.info(`  [${formatTimestamp(row.apple_date)}] rowid=${row.rowid}  ${text}`);
}

export async function dev(): Promise<void> {
  if (!existsSync(CHAT_DB)) {
    log.error(`chat.db not found at ${CHAT_DB}`);
    log.error("Grant Full Disk Access to Terminal in System Settings → Privacy & Security.");
    process.exit(1);
  }

  const db = new Database(CHAT_DB, { readonly: true });
  let lastRowid: number;
  try {
    const row = db
      .query<{ rowid: number }, []>("SELECT COALESCE(MAX(rowid), 0) as rowid FROM message")
      .get();
    lastRowid = row?.rowid ?? 0;
  } finally {
    db.close();
  }

  log.info(`Dev mode — watching ${CHAT_DB}`);
  log.info(`Starting from rowid ${lastRowid}. Send yourself a message!`);

  let debounce: Timer | null = null;

  function poll(): void {
    let rows: MessageRow[];
    try {
      rows = fetchNewMessages(lastRowid);
    } catch (err) {
      log.error(`DB read error: ${err}`);
      return;
    }
    for (const row of rows) {
      printMessage(row);
      lastRowid = row.rowid;
    }
  }

  const watcher = chokidar.watch(MESSAGES_DIR, {
    persistent: true,
    usePolling: false,
    depth: 0,
    ignoreInitial: true,
  });

  watcher.on("all", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(poll, DEBOUNCE_MS);
  });
  watcher.on("error", (err) => log.error(`Watcher error: ${err}`));

  const fallbackInterval = setInterval(poll, 5000);

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      log.info(`${sig} — shutting down`);
      clearInterval(fallbackInterval);
      await watcher.close();
      process.exit(0);
    });
  }
}
