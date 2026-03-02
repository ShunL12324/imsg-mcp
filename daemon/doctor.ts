import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";
import { CloudflareAPI } from "./cf-api.ts";
import { loadState } from "./state.ts";
import { log } from "./logger.ts";
import type { Config } from "./config.ts";

const CHAT_DB = join(homedir(), "Library/Messages/chat.db");

interface Check { name: string; ok: boolean; detail: string }

const pass = (name: string, detail: string): Check => ({ name, ok: true,  detail });
const fail = (name: string, detail: string): Check => ({ name, ok: false, detail });

function checkChatDb(): Check {
  if (!existsSync(CHAT_DB)) {
    return fail("chat.db", `Not found at ${CHAT_DB}. Grant Full Disk Access to Terminal in System Settings → Privacy & Security.`);
  }
  try {
    const db = new Database(CHAT_DB, { readonly: true });
    const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM message").get();
    db.close();
    return pass("chat.db", `Readable — ${row?.count ?? 0} messages`);
  } catch (err) {
    return fail("chat.db", `Exists but unreadable: ${err}`);
  }
}

function checkConfig(config: Config): Check {
  const missing: string[] = [];
  if (!config.api_token)              missing.push("api_token");
  if (!config.cloudflare.account_id)  missing.push("cloudflare.account_id");
  if (!config.cloudflare.api_token)   missing.push("cloudflare.api_token");
  if (missing.length > 0) return fail("config.yaml", `Missing fields: ${missing.join(", ")}`);
  return pass("config.yaml", "All required fields present");
}

async function checkCfCredentials(config: Config): Promise<Check[]> {
  if (!config.cloudflare.account_id || !config.cloudflare.api_token) {
    return [
      fail("CF token", "Not configured"),
      fail("CF account access", "Not configured"),
      fail("CF Workers permission", "Not configured"),
      fail("CF D1 permission", "Not configured"),
    ];
  }
  const api = new CloudflareAPI(config.cloudflare.account_id, config.cloudflare.api_token);

  const [tokenOk, accountResult, workersResult, d1Result] = await Promise.all([
    api.verifyToken(),
    api.verifyAccountAccess(),
    api.verifyWorkersPermission(),
    api.verifyD1Permission(),
  ]);

  return [
    tokenOk
      ? pass("CF token", "Valid")
      : fail("CF token", "Invalid or expired — check cloudflare.api_token"),
    accountResult.ok
      ? pass("CF account access", `account_id ${config.cloudflare.account_id} accessible`)
      : fail("CF account access", accountResult.error ?? "Token lacks permission for this account"),
    workersResult.ok
      ? pass("CF Workers permission", "Can list/manage Workers scripts")
      : fail("CF Workers permission", workersResult.error ?? "Token lacks Workers:Edit permission"),
    d1Result.ok
      ? pass("CF D1 permission", "Can list/manage D1 databases")
      : fail("CF D1 permission", d1Result.error ?? "Token lacks D1:Edit permission"),
  ];
}

async function checkWorker(config: Config): Promise<Check> {
  const state = loadState();
  const workerUrl = config.worker_url || state.deployed?.workerUrl;
  if (!workerUrl) {
    return fail("Worker", 'Not deployed yet. Run "imsg-forwarder --deploy" first.');
  }
  try {
    const res = await fetch(`${workerUrl}/messages`, {
      headers: { Authorization: `Bearer ${config.api_token}` },
    });
    if (res.status === 401) return fail("Worker", `Reachable but got 401 — api_token mismatch? (${workerUrl})`);
    return pass("Worker", `Reachable at ${workerUrl} (HTTP ${res.status})`);
  } catch (err) {
    return fail("Worker", `Unreachable: ${err}`);
  }
}

export async function doctor(config: Config): Promise<void> {
  log.info("Running diagnostics...");

  const cfChecks = await checkCfCredentials(config);
  const [chatDbCheck, configCheck, workerCheck] = await Promise.all([
    Promise.resolve(checkChatDb()),
    Promise.resolve(checkConfig(config)),
    checkWorker(config),
  ]);

  const checks = [chatDbCheck, configCheck, ...cfChecks, workerCheck];

  let allOk = true;
  for (const c of checks) {
    if (c.ok) {
      log.info(`  ✓ ${c.name}: ${c.detail}`);
    } else {
      log.warn(`  ✗ ${c.name}: ${c.detail}`);
      allOk = false;
    }
  }

  log.info(allOk ? "All checks passed." : "Some checks failed.");
  process.exit(allOk ? 0 : 1);
}
