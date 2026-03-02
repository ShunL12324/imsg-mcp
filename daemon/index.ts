import { loadConfig } from "./config.ts";
import { deploy } from "./deploy.ts";
import { undeploy } from "./undeploy.ts";
import { doctor } from "./doctor.ts";
import { watch } from "./watch.ts";
import { dev } from "./dev.ts";

const HELP = `
imsg-forwarder — forward iMessages to Cloudflare

Usage:
  imsg-forwarder                   Start watching and forwarding messages
  imsg-forwarder --dev             Dev mode: print captured messages to stdout
  imsg-forwarder --deploy          Deploy Cloudflare Worker + D1 database
  imsg-forwarder --undeploy        Remove deployed Cloudflare resources
  imsg-forwarder --doctor          Run diagnostics
  imsg-forwarder --help            Show this help

Configuration:
  Copy config.example.yaml → config.yaml and fill in your values.
  Searched in: <binary dir>/config.yaml, ./config.yaml,
               ~/.imsg-forwarder/config.yaml

Run as a service:
  See com.imsg-forwarder.plist.example in the repo for a LaunchAgent template.
`.trim();

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(HELP);
  process.exit(0);
}

// Dev mode needs no config at all
if (args.has("--dev")) {
  await dev();
} else {
  const config = loadConfig();

  if (args.has("--deploy")) {
    await deploy(config);
  } else if (args.has("--undeploy")) {
    await undeploy(config);
  } else if (args.has("--doctor")) {
    await doctor(config);
  } else {
    await watch(config);
  }
}
