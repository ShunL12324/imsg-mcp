import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  API_TOKEN: string;
}

interface MessagePayload {
  text: string | null;
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

// POST /messages  — insert a single message from iOS Shortcut
async function handlePost(request: Request, env: Env): Promise<Response> {
  let msg: MessagePayload;
  try {
    msg = (await request.json()) as MessagePayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const result = await env.DB.prepare(
    `INSERT INTO messages (text, sender, chat_identifier)
     VALUES (?, ?, ?)`
  )
    .bind(msg.text ?? null, msg.sender ?? null, msg.chat_identifier ?? null)
    .run();

  return json({ ok: true, id: result.meta.last_row_id });
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
    conditions.push("received_at < ?");
    bindings.push(parseInt(before));
  }
  if (sender) {
    conditions.push("sender = ?");
    bindings.push(sender);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY received_at DESC LIMIT ?";
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
