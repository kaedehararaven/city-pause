import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";

const servers: Server[] = [];
const localFetch = globalThis.fetch;
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules();
});

async function start(configured = true) {
  vi.stubEnv("SERVER_AK", configured ? "vercel-test-secret" : "");
  const listen = vi.spyOn(Server.prototype, "listen");
  const { default: handler } = await import("../api/[...path].js");
  expect(listen).not.toHaveBeenCalled();
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

it("serves health and validates every endpoint through the actual Vercel entry", async () => {
  const upstream = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", upstream);
  const base = await start(false);
  const health = await localFetch(`${base}/api/health`);
  expect(await health.json()).toEqual({ ok: true });
  expect(health.headers.get("cache-control")).toBe("no-store");
  for (const route of ["place-around", "place-detail", "place-details", "walking-route", "cycling-route"]) {
    expect((await localFetch(`${base}/api/map/${route}`)).status).toBe(400);
  }
  expect((await localFetch(`${base}/api/map/place-detail?uid=test`)).status).toBe(503);
  expect((await localFetch(`${base}/api/missing`)).status).toBe(404);
  expect((await localFetch(`${base}/api/health`, { method: "POST" })).status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it("preserves query parameters, deduplication, cache and credential isolation", async () => {
  const upstream = vi.fn<typeof fetch>().mockImplementation(async input => {
    const url = new URL(String(input));
    expect(url.searchParams.get("ak")).toBe("vercel-test-secret");
    expect(url.searchParams.get("destination_uid")).toBe("test-cafe");
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ status: 0, result: { routes: [{ distance: 413, duration: 352, steps: [] }] } });
  });
  vi.stubGlobal("fetch", upstream);
  const base = await start();
  const url = `${base}/api/map/walking-route?originLat=22.5&originLng=114.1&destinationLat=22.6&destinationLng=114.2&destinationUid=test-cafe`;
  for (const response of await Promise.all([localFetch(url), localFetch(url)])) {
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("vercel-test-secret");
    expect(JSON.parse(body).data.walkingDurationSeconds).toBe(352);
  }
  expect((await localFetch(url)).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(1);
});

it("returns sanitized provider errors from the function", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("URL contains vercel-test-secret")));
  const base = await start();
  const response = await localFetch(`${base}/api/map/walking-route?originLat=22.5&originLng=114.1&destinationLat=22.6&destinationLng=114.2`);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("vercel-test-secret");
});
