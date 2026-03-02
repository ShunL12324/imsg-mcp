const CF_API = "https://api.cloudflare.com/client/v4";
import { log } from "./logger.ts";

export interface D1Database {
  uuid: string;
  name: string;
}

export interface Binding {
  type: "d1" | "secret_text";
  name: string;
  // d1
  id?: string;
  // secret_text
  text?: string;
}

export class CloudflareAPI {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${CF_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as { success: boolean; result: T; errors: { message: string }[] };
    if (!data.success) {
      throw new Error(
        `CF API ${method} ${path}: ${data.errors?.map((e) => e.message).join(", ")}`
      );
    }
    return data.result;
  }

  // ── D1 ──────────────────────────────────────────────────────────────────────

  async findD1Database(name: string): Promise<D1Database | null> {
    const results = await this.request<D1Database[]>(
      "GET",
      `/accounts/${this.accountId}/d1/database?name=${encodeURIComponent(name)}`
    );
    return results.find((db) => db.name === name) ?? null;
  }

  async createD1Database(name: string): Promise<D1Database> {
    return this.request<D1Database>(
      "POST",
      `/accounts/${this.accountId}/d1/database`,
      { name }
    );
  }

  async getOrCreateD1Database(name: string): Promise<D1Database> {
    const existing = await this.findD1Database(name);
    if (existing) {
      log.info(`  D1 database "${name}" already exists (${existing.uuid})`);
      return existing;
    }
    const created = await this.createD1Database(name);
    log.info(`  Created D1 database "${name}" (${created.uuid})`);
    return created;
  }

  async queryD1(databaseId: string, sql: string): Promise<void> {
    await this.request(
      "POST",
      `/accounts/${this.accountId}/d1/database/${databaseId}/query`,
      { sql, params: [] }
    );
  }

  async deleteD1Database(databaseId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/accounts/${this.accountId}/d1/database/${databaseId}`
    );
  }

  // ── Workers ──────────────────────────────────────────────────────────────────

  async uploadWorker(
    scriptName: string,
    scriptContent: string,
    bindings: Binding[]
  ): Promise<void> {
    const metadata = {
      main_module: "worker.js",
      compatibility_date: "2024-09-23",
      bindings,
    };

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json"
    );
    form.append(
      "worker.js",
      new Blob([scriptContent], { type: "application/javascript+module" }),
      "worker.js"
    );

    const res = await fetch(
      `${CF_API}/accounts/${this.accountId}/workers/scripts/${scriptName}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: form,
      }
    );
    const data = (await res.json()) as { success: boolean; errors: { message: string }[] };
    if (!data.success) {
      throw new Error(
        `Worker upload failed: ${data.errors?.map((e) => e.message).join(", ")}`
      );
    }
  }

  async enableWorkersDev(scriptName: string): Promise<void> {
    await this.request(
      "POST",
      `/accounts/${this.accountId}/workers/scripts/${scriptName}/subdomain`,
      { enabled: true }
    );
  }

  async getAccountSubdomain(): Promise<string> {
    const result = await this.request<{ subdomain: string }>(
      "GET",
      `/accounts/${this.accountId}/workers/subdomain`
    );
    return result.subdomain;
  }

  async deleteWorker(scriptName: string): Promise<void> {
    await this.request(
      "DELETE",
      `/accounts/${this.accountId}/workers/scripts/${scriptName}`
    );
  }

  async verifyToken(): Promise<boolean> {
    try {
      const res = await fetch(`${CF_API}/user/tokens/verify`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const data = (await res.json()) as { success: boolean };
      return data.success;
    } catch {
      return false;
    }
  }

  async verifyAccountAccess(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${CF_API}/accounts/${this.accountId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const data = (await res.json()) as { success: boolean; errors: { message: string }[] };
      if (!data.success) {
        return { ok: false, error: data.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async verifyWorkersPermission(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${CF_API}/accounts/${this.accountId}/workers/scripts`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const data = (await res.json()) as { success: boolean; errors: { message: string }[] };
      if (!data.success) {
        return { ok: false, error: data.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async verifyD1Permission(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${CF_API}/accounts/${this.accountId}/d1/database`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const data = (await res.json()) as { success: boolean; errors: { message: string }[] };
      if (!data.success) {
        return { ok: false, error: data.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
