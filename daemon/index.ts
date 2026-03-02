import { loadConfig } from "./config.ts";
import { deploy } from "./deploy.ts";
import { undeploy } from "./undeploy.ts";
import { doctor } from "./doctor.ts";

const HELP = `
imsg-forwarder — forward iMessages to Cloudflare via iOS Shortcuts

Usage:
  imsg-forwarder --deploy          Deploy Cloudflare Worker + D1 database
  imsg-forwarder --undeploy        Remove deployed Cloudflare resources
  imsg-forwarder --doctor          Run diagnostics
  imsg-forwarder --help            Show this help

Configuration:
  Copy config.example.yaml → config.yaml and fill in your values.
  Searched in: <binary dir>/config.yaml, ./config.yaml,
               ~/.imsg-forwarder/config.yaml

iOS Shortcut:
  POST https://<worker>.workers.dev/messages
  Authorization: Bearer <api_token>
  Body (JSON): { "text": "...", "sender": "...", "chat_identifier": "..." }
`.trim();

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(HELP);
  process.exit(0);
}

const config = loadConfig();

if (args.has("--deploy")) {
  await deploy(config);
} else if (args.has("--undeploy")) {
  await undeploy(config);
} else if (args.has("--doctor")) {
  await doctor(config);
} else {
  console.log(HELP);
  process.exit(0);
}
