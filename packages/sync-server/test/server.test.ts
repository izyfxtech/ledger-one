import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer } from "../src/server";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";

describe("sync server HTTP endpoints", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const created = createServer(":memory:");
    server = created.server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /v1/health responds ok", async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("pull on a brand-new account returns version 0 and a null blob", async () => {
    const res = await fetch(`${baseUrl}/v1/sync/pull?accountId=acct_1`, {
      headers: { Authorization: "Bearer token_1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 0, blob: null });
  });

  it("pull without an Authorization header is rejected", async () => {
    const res = await fetch(`${baseUrl}/v1/sync/pull?accountId=acct_1`);
    expect(res.status).toBe(400);
  });

  it("push then pull round-trips a blob", async () => {
    const push = await fetch(`${baseUrl}/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token_1" },
      body: JSON.stringify({ accountId: "acct_1", expectedVersion: 0, blob: "hello-ciphertext" }),
    });
    expect(push.status).toBe(200);
    expect(await push.json()).toEqual({ ok: true, version: 1 });

    const pull = await fetch(`${baseUrl}/v1/sync/pull?accountId=acct_1`, {
      headers: { Authorization: "Bearer token_1" },
    });
    expect(await pull.json()).toEqual({ version: 1, blob: "hello-ciphertext" });
  });

  it("a conflicting push returns 409 with the server's current version and blob", async () => {
    await fetch(`${baseUrl}/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token_1" },
      body: JSON.stringify({ accountId: "acct_1", expectedVersion: 0, blob: "v1" }),
    });
    await fetch(`${baseUrl}/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token_1" },
      body: JSON.stringify({ accountId: "acct_1", expectedVersion: 1, blob: "v2" }),
    });
    // Retry with the now-stale expectedVersion=1.
    const conflict = await fetch(`${baseUrl}/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token_1" },
      body: JSON.stringify({ accountId: "acct_1", expectedVersion: 1, blob: "v2-conflicting" }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ ok: false, version: 2, blob: "v2" });
  });

  it("using the wrong bearer token for an existing account is rejected with 401", async () => {
    await fetch(`${baseUrl}/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token_1" },
      body: JSON.stringify({ accountId: "acct_1", expectedVersion: 0, blob: "v1" }),
    });
    const res = await fetch(`${baseUrl}/v1/sync/pull?accountId=acct_1`, {
      headers: { Authorization: "Bearer wrong_token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed push body", async () => {
    const res = await fetch(`${baseUrl}/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token_1" },
      body: JSON.stringify({ accountId: "acct_1" }), // missing expectedVersion/blob
    });
    expect(res.status).toBe(400);
  });

  it("responds to CORS preflight (OPTIONS)", async () => {
    const res = await fetch(`${baseUrl}/v1/sync/push`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s on an unknown route", async () => {
    const res = await fetch(`${baseUrl}/v1/nonsense`);
    expect(res.status).toBe(404);
  });
});
