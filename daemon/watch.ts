import chokidar from "chokidar";
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { loadState, saveState } from "./state.ts";
import { log } from "./logger.ts";
import { QUERY, APPLE_EPOCH_OFFSET, resolveText } from "./chat-db.ts";
import type { Config } from "./config.ts";
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

async function forward(
  rows: MessageRow[],
  workerUrl: string,
  apiToken: string
): Promise<void> {
  const payload = rows.map((r) => ({
    guid: r.guid,
    text: resolveText(r),
    is_from_me: r.is_from_me === 1,
    timestamp: Math.floor(r.apple_date / 1e9) + APPLE_EPOCH_OFFSET,
    sender: r.sender,
    chat_identifier: r.chat_identifier,
  }));

  const res = await fetch(`${workerUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Worker ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { inserted: number; total: number };
  log.debug(`Worker ack: inserted=${data.inserted}/${data.total}`);
}

export async function watch(config: Config): Promise<void> {
  const state = loadState();
  const workerUrl = config.worker_url || state.deployed?.workerUrl || "";
  const apiToken = config.api_token;

  if (!workerUrl) {
    log.error('Worker URL not found. Run "imsg-forwarder --deploy" first, or set worker_url in config.yaml.');
    process.exit(1);
  }
  if (!apiToken) {
    log.error("api_token is required in config.yaml");
    process.exit(1);
  }
  if (!existsSync(CHAT_DB)) {
    log.error(`chat.db not found at ${CHAT_DB}`);
    log.error("Grant Full Disk Access to Terminal in System Settings → Privacy & Security.");
    process.exit(1);
  }

  // Bootstrap: skip existing messages on first run
  if (state.lastRowid === 0) {
    const db = new Database(CHAT_DB, { readonly: true });
    try {
      const row = db
        .query<{ rowid: number }, []>("SELECT COALESCE(MAX(rowid), 0) as rowid FROM message")
        .get();
      state.lastRowid = row?.rowid ?? 0;
    } finally {
      db.close();
    }
    saveState(state);
    log.info(`Bootstrap: starting from rowid ${state.lastRowid}`);
  }

  log.info(`Watching ${CHAT_DB} (rowid > ${state.lastRowid})`);
  log.info(`Forwarding to ${workerUrl}`);

  let debounce: Timer | null = null;

  async function poll(): Promise<void> {
    let rows: MessageRow[];
    try {
      rows = fetchNewMessages(state.lastRowid);
    } catch (err) {
      log.error(`DB read error: ${err}`);
      return;
    }

    if (rows.length === 0) return;

    log.info(`${rows.length} new message(s) — forwarding`);
    for (const r of rows) {
      const dir = r.is_from_me ? "→ sent" : "← recv";
      log.debug(`  ${dir} rowid=${r.rowid} sender=${r.sender ?? "me"} text=${JSON.stringify(r.text)}`);
    }

    try {
      await forward(rows, workerUrl, apiToken);
      state.lastRowid = rows[rows.length - 1]!.rowid;
      saveState(state);
      log.info(`Forwarded — lastRowid now ${state.lastRowid}`);
    } catch (err) {
      log.error(`Forward failed: ${err}`);
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

  // Fallback poll every 5s to catch sync writes that slip past FSEvents
  const fallbackInterval = setInterval(poll, 5000);

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      log.info(`${sig} received, shutting down`);
      clearInterval(fallbackInterval);
      await watcher.close();
      process.exit(0);
    });
  }
}
