import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { SyncStore, hashToken } from "./store";

const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25MB — generous for a personal ledger's full encrypted state

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    // Tauri's webview makes this request as a normal cross-origin fetch —
    // there's no cookie-based session to protect, auth is a bearer token
    // the client attaches explicitly, so a permissive CORS policy here
    // doesn't weaken anything.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(data);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function createServer(dbPath: string) {
  const store = new SyncStore(dbPath);

  const server = createHttpServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/v1/sync/pull") {
        const accountId = url.searchParams.get("accountId");
        const token = bearerToken(req);
        if (!accountId || !token) {
          sendJson(res, 400, { error: "accountId and Authorization are required" });
          return;
        }
        const result = store.pull(accountId, hashToken(token));
        if (!result.authorized) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        sendJson(res, 200, { version: result.version, blob: result.blob });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/sync/push") {
        const token = bearerToken(req);
        if (!token) {
          sendJson(res, 400, { error: "Authorization is required" });
          return;
        }
        const raw = await readBody(req);
        let body: { accountId?: string; expectedVersion?: number; blob?: string };
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: "Malformed JSON body" });
          return;
        }
        if (!body.accountId || typeof body.expectedVersion !== "number" || typeof body.blob !== "string") {
          sendJson(res, 400, { error: "accountId, expectedVersion, and blob are required" });
          return;
        }
        const result = store.push(body.accountId, hashToken(token), body.expectedVersion, body.blob);
        if (!result.authorized) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        if (result.ok) {
          sendJson(res, 200, { ok: true, version: result.version });
        } else {
          sendJson(res, 409, { ok: false, version: result.version, blob: result.blob });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return { server, store };
}
