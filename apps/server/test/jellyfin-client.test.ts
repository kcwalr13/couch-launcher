import { expect, test } from "bun:test";
import {
  authorizationHeader,
  buildUrl,
  JellyfinClient,
  JellyfinError,
  JF,
} from "../src/adapters/jellyfin/client.ts";

test("authorization header uses the MediaBrowser scheme with the token", () => {
  const h = authorizationHeader({ apiKey: "k3y", deviceId: "dev-1", deviceName: "living-room" });
  expect(h).toStartWith("MediaBrowser ");
  expect(h).toContain('Client="Couch Launcher"');
  expect(h).toContain('DeviceId="dev-1"');
  expect(h).toContain('Token="k3y"');
});

test("header values cannot break out of their quotes", () => {
  const h = authorizationHeader({ apiKey: 'a"b,c', deviceId: "d", deviceName: "n\r\nX: y" });
  expect(h).toContain('Token="abc"');
  expect(h).not.toContain("\n");
});

test("current endpoint paths", () => {
  expect(JF.resume).toBe("/UserItems/Resume");
  expect(JF.nextUp).toBe("/Shows/NextUp");
  expect(JF.latest).toBe("/Items/Latest");
  expect(JF.image("abc", "Backdrop", 0)).toBe("/Items/abc/Images/Backdrop/0");
  expect(JF.playing("s1")).toBe("/Sessions/s1/Playing");
  expect(buildUrl("http://nas:8096/", "/Items", { userId: "u", limit: 5, x: undefined })).toBe(
    "http://nas:8096/Items?userId=u&limit=5",
  );
});

test("the key is sent only in the header, never in the URL", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const c = new JellyfinClient({
    url: "http://nas:8096",
    apiKey: "secret",
    deviceId: "d",
    deviceName: "n",
    fetch: async (url, init) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return Response.json({ ok: 1 });
    },
  });
  await c.getJson(JF.resume, { userId: "u" });
  expect(seen[0]?.url).not.toContain("secret");
  expect(seen[0]?.headers.authorization).toContain('Token="secret"');
});

test("errors are classified", async () => {
  const mk = (f: () => Promise<Response>) =>
    new JellyfinClient({ url: "http://nas:8096", apiKey: "k", deviceId: "d", deviceName: "n", fetch: f });
  await expect(mk(async () => new Response("", { status: 401 })).getJson("/x")).rejects.toMatchObject({
    kind: "auth",
  });
  await expect(mk(async () => new Response("", { status: 500 })).getJson("/x")).rejects.toMatchObject({
    kind: "http",
  });
  await expect(
    mk(async () => {
      throw new TypeError("ECONNREFUSED");
    }).getJson("/x"),
  ).rejects.toBeInstanceOf(JellyfinError);
});
