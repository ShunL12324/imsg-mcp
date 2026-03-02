import { CloudflareAPI } from "./cf-api.ts";
import { loadState, saveState } from "./state.ts";
import { log } from "./logger.ts";
import type { Config } from "./config.ts";
import { join } from "path";

async function buildWorkerBundle(): Promise<string> {
  const { WORKER_BUNDLE } = await import("./worker-bundle.ts");
  if (WORKER_BUNDLE) return WORKER_BUNDLE;

  // Fallback: build on the fly in dev mode (not used in compiled binary)
  log.warn("worker-bundle.ts is empty — building worker on the fly");
  const entry = join(import.meta.dir, "../worker/src/index.ts");
  const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true });
  if (!result.success) throw new Error("Worker bundle failed:\n" + result.logs.join("\n"));
  return result.outputs[0].text();
}

async function getSchema(): Promise<string> {
  const { SCHEMA_SQL } = await import("./schema-bundle.ts");
  if (SCHEMA_SQL) return SCHEMA_SQL;
  throw new Error("schema-bundle.ts is empty — run build.ts first");
}

function splitSql(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);
}

export async function deploy(config: Config): Promise<void> {
  const { cloudflare: cf, api_token } = config;

  if (!cf.account_id || !cf.api_token) {
    log.error("cloudflare.account_id and cloudflare.api_token are required in config.yaml");
    process.exit(1);
  }
  if (!api_token) {
    log.error("api_token is required in config.yaml");
    process.exit(1);
  }

  const api = new CloudflareAPI(cf.account_id, cf.api_token);
  const { worker_name, db_name } = cf;

  log.info(`Deploying "${worker_name}" to Cloudflare...`);

  const [workerJs, schema] = await Promise.all([buildWorkerBundle(), getSchema()]);

  // 1. Provision D1
  log.info("[1/4] Provisioning D1 database...");
  const db = await api.getOrCreateD1Database(db_name);

  // 2. Apply schema
  log.info("[2/4] Applying schema...");
  const statements = splitSql(schema);
  for (const sql of statements) {
    await api.queryD1(db.uuid, sql);
  }
  log.info(`  Applied ${statements.length} statement(s)`);

  // 3. Upload worker
  log.info("[3/4] Uploading worker script...");
  await api.uploadWorker(worker_name, workerJs, [
    { type: "d1", name: "DB", id: db.uuid },
    { type: "secret_text", name: "API_TOKEN", text: api_token },
  ]);
  log.info("  Worker uploaded");

  // 4. Enable workers.dev
  log.info("[4/4] Enabling workers.dev...");
  await api.enableWorkersDev(worker_name);
  const subdomain = await api.getAccountSubdomain();
  const workerUrl = `https://${worker_name}.${subdomain}.workers.dev`;
  log.info(`  URL: ${workerUrl}`);

  const state = loadState();
  state.deployed = {
    workerName: worker_name,
    workerUrl,
    d1DatabaseId: db.uuid,
    d1DatabaseName: db_name,
  };
  saveState(state);

  log.info(`Done! Worker deployed at ${workerUrl}`);
}
