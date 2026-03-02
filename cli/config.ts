import { existsSync, readFileSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(import.meta.dir, "..", "config.yaml");

export interface Config {
  cloudflare: {
    account_id: string;
    api_token: string;
    worker_name: string;
    db_name: string;
  };
  api_token: string;
  worker_url: string;
}

function parseYaml(text: string): Record<string, unknown> {
  const lines = text.split("\n");
  const root: Record<string, unknown> = {};
  let currentSection: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trimEnd(); // strip inline comments
    if (!line.trim()) continue;

    const indented = line.startsWith("  ");
    const colonIdx = line.trim().indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.trim().slice(0, colonIdx).trim();
    const rawValue = line.trim().slice(colonIdx + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, ""); // strip surrounding quotes

    if (!indented) {
      if (!rawValue) {
        currentSection = key;
        root[currentSection] = {};
      } else {
        currentSection = null;
        root[key] = value;
      }
    } else if (currentSection) {
      (root[currentSection] as Record<string, string>)[key] = value;
    }
  }
  return root;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    console.error(
      `config.yaml not found at ${CONFIG_PATH}\n` +
      "Copy config.example.yaml → config.yaml and fill in your values."
    );
    process.exit(1);
  }

  const raw = parseYaml(readFileSync(CONFIG_PATH, "utf8"));
  const cf = (raw.cloudflare ?? {}) as Record<string, string>;

  return {
    cloudflare: {
      account_id:  cf.account_id  ?? "",
      api_token:   cf.api_token   ?? "",
      worker_name: cf.worker_name || "imsg-mcp",
      db_name:     cf.db_name     || "imsg-mcp",
    },
    api_token:  (raw.api_token  as string) ?? "",
    worker_url: (raw.worker_url as string) ?? "",
  };
}

export function validateConfig(
  config: Config,
  { needsCf = false }: { needsCf?: boolean } = {}
): string[] {
  const errors: string[] = [];
  if (!config.api_token) errors.push("api_token is required");
  if (needsCf) {
    if (!config.cloudflare.account_id) errors.push("cloudflare.account_id is required");
    if (!config.cloudflare.api_token)  errors.push("cloudflare.api_token is required");
  }
  return errors;
}
