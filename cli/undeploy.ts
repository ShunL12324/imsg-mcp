import { CloudflareAPI } from "./cf-api.ts";
import { loadState, saveState } from "./state.ts";
import { log } from "./logger.ts";
import type { Config } from "./config.ts";

export async function undeploy(config: Config): Promise<void> {
  const { cloudflare: cf } = config;

  if (!cf.account_id || !cf.api_token) {
    log.error("cloudflare.account_id and cloudflare.api_token are required in config.yaml");
    process.exit(1);
  }

  const state = loadState();
  const deployed = state.deployed;

  if (!deployed) {
    log.error("No deployed resources found in state. Nothing to remove.");
    process.exit(1);
  }

  const api = new CloudflareAPI(cf.account_id, cf.api_token);
  const { workerName, d1DatabaseId, d1DatabaseName } = deployed;

  log.info(`Removing "${workerName}" from Cloudflare...`);

  try {
    await api.deleteWorker(workerName);
    log.info(`Deleted worker "${workerName}"`);
  } catch (err) {
    log.error(`Failed to delete worker: ${err}`);
  }

  try {
    await api.deleteD1Database(d1DatabaseId);
    log.info(`Deleted D1 database "${d1DatabaseName}" (${d1DatabaseId})`);
  } catch (err) {
    log.error(`Failed to delete D1 database: ${err}`);
  }

  delete state.deployed;
  saveState(state);
  log.info("Undeploy complete.");
}
