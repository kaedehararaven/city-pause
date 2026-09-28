import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMakersApp } from "./makersApp.js";

const servers: Server[] = [];
async function start(options: Parameters<typeof createMakersApp>[0] = {}) {
  const server = createServer(createMakersApp(options));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Makers thin API entry", () => {
  it("imports the actual function without listening on a port", async () => {
    vi.stubEnv("SERVER_AK", "test-only-makers-secret");
    const listen = vi.spyOn(Server.prototype, "listen");
    const { default: app } = await import("../cloud-functions/api/[[default]].js");
    expect(typeof app).toBe("function");
    expect(app.listen).toBeTypeOf("function");
    expect(listen).not.toHaveBeenCalled();
  });
  it.each(["/api", ""])("supports %s prefixed routes without provider calls", async prefix => {
    const fetchImpl = vi.fn<typeof fetch>();
    const base = await start({ fetchImpl });
    const health = await fetch(`${base}${prefix}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(health.headers.get("x-powered-by")).toBeNull();
    for (const endpoint of ["place-around", "place-details", "place-detail", "walking-route", "cycling-route"]) {
      expect((await fetch(`${base}${prefix}/map/${endpoint}`)).status).toBe(400);
    }
    const missingKey = await fetch(`${base}${prefix}/map/place-detail?uid=test`);
    expect(missingKey.status).toBe(503);
    expect((await fetch(`${base}${prefix}/unknown`)).status).toBe(404);
    expect((await fetch(`${base}${prefix}/health`, { method: "POST" })).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("keeps route deduplication and warm-instance cache across URL forms", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return Response.json({ status: 0, result: { routes: [{ distance: 620, duration: 480, steps: [] }] } });
    });
    const base = await start({ serverAk: "test-only-makers-secret", fetchImpl });
    const path = "/map/walking-route?originLat=22.5&originLng=114.1&destinationLat=22.6&destinationLng=114.2";
    const results = await Promise.all([fetch(`${base}/api${path}`), fetch(`${base}${path}`)]);
    for (const response of results) {
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain("test-only-makers-secret");
      expect(JSON.parse(body).data.walkingDurationSeconds).toBe(480);
    }
    expect((await fetch(`${base}/api${path}`)).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("retains place 302 cooldown and sanitized responses", async () => {
    const secret = "test-only-makers-secret";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 302, message: secret }));
    const base = await start({ serverAk: secret, fetchImpl });
    for (const uid of ["one", "two"]) {
      const response = await fetch(`${base}/api/map/place-detail?uid=${uid}`);
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).not.toContain(secret);
      expect(JSON.parse(body).providerStatus).toBe(302);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
