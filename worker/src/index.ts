import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  API_TOKEN: string;
}

interface MessagePayload {
  guid: string;
  text: string | null;
  is_from_me: boolean;
  timestamp: number;
  sender: string | null;
  chat_identifier: string | null;
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${env.API_TOKEN}`;
}

// POST /messages  — batch insert from daemon
async function handlePost(request: Request, env: Env): Promise<Response> {
  let messages: MessagePayload[];
  try {
    messages = (await request.json()) as MessagePayload[];
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Expected non-empty array", { status: 400 });
  }

  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO messages
       (guid, text, sender, is_from_me, chat_identifier, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Batch all inserts in a single transaction
  const results = await env.DB.batch(
    messages.map((m) =>
      stmt.bind(
        m.guid,
        m.text ?? null,
        m.sender ?? null,
        m.is_from_me ? 1 : 0,
        m.chat_identifier ?? null,
        m.timestamp
      )
    )
  );

  const inserted = results.filter((r) => r.meta.changes > 0).length;
  return json({ ok: true, inserted, total: messages.length });
}

// GET /messages  — query stored messages
async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const before = url.searchParams.get("before"); // Unix timestamp
  const sender = url.searchParams.get("sender");

  let query = "SELECT * FROM messages";
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (before) {
    conditions.push("timestamp < ?");
    bindings.push(parseInt(before));
  }
  if (sender) {
    conditions.push("sender = ?");
    bindings.push(sender);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY timestamp DESC LIMIT ?";
  bindings.push(limit);

  const { results } = await env.DB.prepare(query)
    .bind(...bindings)
    .all();

  return json({ messages: results });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAuthorized(request, env)) return unauthorized();

    const { method } = request;
    const path = new URL(request.url).pathname;

    if (path === "/messages") {
      if (method === "POST") return handlePost(request, env);
      if (method === "GET") return handleGet(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
