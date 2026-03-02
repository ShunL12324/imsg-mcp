import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".imsg-forwarder");
const STATE_FILE = join(STATE_DIR, "state.json");

export interface DeployedResources {
  workerName: string;
  workerUrl: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
}

export interface State {
  lastRowid: number;
  deployed?: DeployedResources;
}

export function loadState(): State {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
    } catch {
      // corrupted state, start fresh
    }
  }
  return { lastRowid: 0 };
}

export function saveState(state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
