# imsg-forwarder

Forward iMessages from your Mac to a Cloudflare Worker + D1 database in real time.

A compiled macOS daemon watches `~/Library/Messages/chat.db` for new messages via FSEvents and POSTs them to a self-hosted Cloudflare Worker, where they are stored in a D1 (SQLite) database queryable over HTTP.

## Architecture

```
Mac (chat.db)
  └── imsg-forwarder daemon
        └── POST /messages  ──►  Cloudflare Worker
                                        └── D1 Database
                                              └── GET /messages
```

- **Daemon** — native macOS binary (Bun-compiled), watches `chat.db`, resolves message text from both `text` and `attributedBody` columns, batches and forwards to the worker.
- **Worker** — Cloudflare Worker (TypeScript), authenticated with a Bearer token, stores messages idempotently using the message GUID.
- **Database** — Cloudflare D1 (SQLite), queryable by timestamp, sender, or chat identifier.

## Requirements

- macOS (Apple Silicon or Intel)
- [Bun](https://bun.sh) ≥ 1.0 (for building from source)
- Cloudflare account (free tier is sufficient)
- **Full Disk Access** granted to the process running the daemon (Terminal or your LaunchAgent binary)

## Installation

### Pre-built binary

Download the latest binary from [Releases](../../releases) and place it in your PATH:

```bash
sudo cp imsg-forwarder /usr/local/bin/imsg-forwarder
sudo codesign --force --sign - /usr/local/bin/imsg-forwarder
```

> **Required after every binary update:** macOS AMFI invalidates trust when a binary is replaced. Re-signing with `-` (ad-hoc) restores it.

### Build from source

```bash
git clone https://github.com/ShunL12324/imsg-forwarder.git
cd imsg-forwarder
bun install
bun run build.ts
sudo cp dist/imsg-forwarder /usr/local/bin/imsg-forwarder
sudo codesign --force --sign - /usr/local/bin/imsg-forwarder
```

Output binaries:
- `dist/imsg-forwarder` — Apple Silicon (arm64)
- `dist/imsg-forwarder-x64` — Intel (x64)

## Configuration

Copy the example config and fill in your values:

```bash
mkdir -p ~/.imsg-forwarder
cp config.example.yaml ~/.imsg-forwarder/config.yaml
```

```yaml
cloudflare:
  account_id: ""       # Cloudflare account ID (dash.cloudflare.com → right sidebar)
  api_token: ""        # API token with Workers:Edit + D1:Edit permissions
  worker_name: "imsg-forwarder"
  db_name: "imsg-forwarder"

api_token: ""          # Shared secret for daemon → worker auth (openssl rand -hex 32)
worker_url: ""         # Leave empty — populated automatically by --deploy
```

Config is searched in order:
1. `<binary directory>/config.yaml`
2. `./config.yaml`
3. `~/.imsg-forwarder/config.yaml`

### Cloudflare API token

Create a token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with these permissions:

| Permission | Level |
|---|---|
| Workers Scripts — Edit | Account |
| D1 — Edit | Account |

## Usage

### Deploy

Provisions the Cloudflare Worker and D1 database, then saves the worker URL to `~/.imsg-forwarder/state.json`.

```bash
imsg-forwarder --deploy
```

### Watch (forward messages)

Starts the daemon. Watches `chat.db` via FSEvents with a 500 ms debounce and a 5 s fallback poll. On first run, skips existing messages and begins forwarding from the current position.

```bash
imsg-forwarder
```

### Dev mode

Prints captured messages to stdout without forwarding. Useful for verifying Full Disk Access and testing the message parser. No config required.

```bash
imsg-forwarder --dev
```

### Diagnostics

Runs a suite of checks: chat.db access, config completeness, Cloudflare token validity, Workers/D1 permissions, and worker reachability.

```bash
imsg-forwarder --doctor
```

### Undeploy

Removes the Cloudflare Worker and D1 database.

```bash
imsg-forwarder --undeploy
```

## Run as a LaunchAgent

To start the daemon automatically on login and restart it on crash, install it as a macOS LaunchAgent.

1. Copy and edit the example plist:

```bash
cp com.imsg-forwarder.plist.example \
   ~/Library/LaunchAgents/com.imsg-forwarder.plist
```

Edit the plist and replace `YOUR_USERNAME` with your macOS username in the log path fields.

2. Load the agent:

```bash
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.imsg-forwarder.plist
```

3. Grant **Full Disk Access** to `/usr/local/bin/imsg-forwarder`:

   **System Settings → Privacy & Security → Full Disk Access → + → `/usr/local/bin/imsg-forwarder`**

   This is required once. FDA persists across restarts but must be re-granted if the binary path changes.

4. Verify it is running:

```bash
launchctl print gui/$(id -u)/com.imsg-forwarder
```

To stop and unload:

```bash
launchctl bootout gui/$(id -u) \
  ~/Library/LaunchAgents/com.imsg-forwarder.plist
```

## Querying messages

The worker exposes a simple REST API, authenticated with your `api_token`.

```bash
# Fetch latest 50 messages
curl -H "Authorization: Bearer <api_token>" \
  https://<worker-subdomain>.workers.dev/messages

# Filter by sender
curl -H "Authorization: Bearer <api_token>" \
  "https://<worker-subdomain>.workers.dev/messages?sender=%2B15555550123"

# Paginate (before Unix timestamp)
curl -H "Authorization: Bearer <api_token>" \
  "https://<worker-subdomain>.workers.dev/messages?before=1700000000&limit=100"
```

### Response schema

```json
{
  "messages": [
    {
      "id": 1,
      "guid": "...",
      "text": "Hello",
      "sender": "+15555550123",
      "is_from_me": 0,
      "chat_identifier": "+15555550123",
      "timestamp": 1700000000,
      "received_at": 1700000001
    }
  ]
}
```

## How it works

1. `chokidar` watches `~/Library/Messages/` for FSEvents. On any change, a 500 ms debounce fires.
2. The daemon queries `chat.db` for rows with `rowid > lastRowid`, reads both the `text` column and the binary `attributedBody` blob (NSKeyedArchiver plist, used for messages from external contacts), and resolves the plain text.
3. New messages are POSTed as a batch to `POST /messages` on the worker. The worker inserts them with `INSERT OR IGNORE` (idempotent on GUID).
4. `lastRowid` is persisted to `~/.imsg-forwarder/state.json` so the daemon resumes correctly after restart.

## License

MIT
