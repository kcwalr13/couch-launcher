import { afterEach, expect, test } from "bun:test";
import type { StatusResponse } from "@couch/core";
import { makeTestApp, type TestApp } from "./helpers.ts";

let t: TestApp;
afterEach(() => t.cleanup());

test("GET /api/status answers in mock mode", async () => {
  t = makeTestApp();
  const res = await t.get("/api/status");
  expect(res.status).toBe(200);
  const body = (await res.json()) as StatusResponse;
  expect(body.mock).toBe(true);
  expect(body.platform).toBe("linux");
  expect(body.now).toBe("2026-10-03T19:00:00.000Z");
});

test("unknown API paths are 404 and wrong methods 405", async () => {
  t = makeTestApp();
  expect((await t.get("/api/nope")).status).toBe(404);
  expect((await t.send("DELETE", "/api/status")).status).toBe(405);
});

test("the API key never appears in the status response", async () => {
  t = makeTestApp({
    mock: false,
    configure: (c) => {
      c.jellyfin.url = "http://nas:8096";
      c.jellyfin.api_key = "supersecretkey";
    },
  });
  const text = await (await t.get("/api/status")).text();
  expect(text).not.toContain("supersecretkey");
});
