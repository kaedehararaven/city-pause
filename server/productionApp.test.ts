import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createProductionApp } from "./productionApp.js";

const servers: Server[] = [], directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve, reject) => s.close(e => e ? reject(e) : resolve()))));
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

it("serves the SPA and assets while keeping all API routes out of HTML fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "city-pause-production-")); directories.push(directory);
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Pause</title>");
  await writeFile(join(directory, "assets", "app.js"), "console.log('app');");
  await writeFile(join(directory, ".env.local"), "SHOULD_NOT_BE_PUBLIC");
  const upstream = vi.fn<typeof fetch>();
  const server = createServer(createProductionApp({ fetchImpl: upstream }, directory)); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "0.0.0.0", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of ["/", "/?replay=1", "/journeys/test"]) {
    const response = await fetch(base + path, { headers: { accept: "text/html" } });
    expect(response.status).toBe(200); expect(await response.text()).toContain("<title>Pause</title>");
  }
  const asset = await fetch(base + "/assets/app.js");
  expect(asset.status).toBe(200); expect(await asset.text()).toContain("console.log");
  const health = await fetch(base + "/api/health");
  expect(await health.json()).toEqual({ ok: true });
  for (const endpoint of ["place-around", "place-detail", "place-details", "walking-route", "cycling-route"]) {
    const response = await fetch(`${base}/api/map/${endpoint}`);
    expect(response.status).toBe(400); expect(response.headers.get("content-type")).toContain("application/json");
  }
  const unknown = await fetch(base + "/api/missing", { headers: { accept: "text/html" } });
  expect(unknown.status).toBe(404); expect(await unknown.json()).toEqual({ ok: false, error: "Not found" });
  expect((await fetch(base + "/api/map/place-detail?uid=test")).status).toBe(503);
  for (const path of ["/.env.local", "/assets/missing.js", "/.git/config"]) {
    const response = await fetch(base + path);
    expect(response.status).toBe(404); expect(await response.text()).not.toContain("SHOULD_NOT_BE_PUBLIC");
  }
  expect((await fetch(base + "/journeys", { method: "POST" })).status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});
