import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Search order: repo root → CWD → home dir
const SEARCH_PATHS = [
  join(import.meta.dir, "..", "config.yaml"),
  join(process.cwd(), "config.yaml"),
  join(homedir(), ".imsg-forwarder", "config.yaml"),
];

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
        // Section header: "cloudflare:" with no value
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

export function findConfigPath(): string | null {
  for (const p of SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadConfig(): Config {
  const configPath = findConfigPath();
  if (!configPath) {
    console.error(
      "config.yaml not found.\n" +
      "Copy config.example.yaml → config.yaml and fill in your values.\n" +
      "Searched:\n" +
      SEARCH_PATHS.map((p) => `  ${p}`).join("\n")
    );
    process.exit(1);
  }

  const raw = parseYaml(readFileSync(configPath, "utf8"));
  const cf = (raw.cloudflare ?? {}) as Record<string, string>;

  return {
    cloudflare: {
      account_id:  cf.account_id  ?? "",
      api_token:   cf.api_token   ?? "",
      worker_name: cf.worker_name || "imsg-forwarder",
      db_name:     cf.db_name     || "imsg-forwarder",
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
