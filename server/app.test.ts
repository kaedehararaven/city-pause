import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppServer } from "./app.js";

const activeServers: ReturnType<typeof createAppServer>[] = [];

async function startServer(options?: Parameters<typeof createAppServer>[0]) {
  const server = createAppServer(options);
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("GET /api/health", () => {
  it("returns the backend health status", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe("map capability endpoints", () => {
  it("rejects missing and invalid route coordinates before contacting Baidu", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const baseUrl = await startServer({ serverAk: "test-secret", fetchImpl });

    const missing = await fetch(`${baseUrl}/api/map/walking-route`);
    const invalid = await fetch(
      `${baseUrl}/api/map/walking-route?originLat=91&originLng=1&destinationLat=2&destinationLng=3`,
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an invalid place uid", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const baseUrl = await startServer({ serverAk: "test-secret", fetchImpl });

    const response = await fetch(`${baseUrl}/api/map/place-detail?uid=bad%20uid`);

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("converts provider errors without exposing the Server AK", async () => {
    const serverAk = "server-secret-must-not-leak";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 4, message: `quota ${serverAk}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const baseUrl = await startServer({ serverAk, fetchImpl });

    const response = await fetch(
      `${baseUrl}/api/map/place-detail?uid=0123456789abcdef`,
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain(serverAk);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      error: "Place detail provider failed",
      providerStatus: 4,
    });
  });

  it("returns only the adapted walking route and never the Server AK", async () => {
    const serverAk = "server-secret-must-not-leak";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: 0,
        result: { routes: [{ distance: 620, duration: 480, steps: [] }] },
      }),
    );
    const baseUrl = await startServer({ serverAk, fetchImpl });

    const response = await fetch(
      `${baseUrl}/api/map/walking-route?originLat=22.5&originLng=114.1&destinationLat=22.6&destinationLng=114.2`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain(serverAk);
    expect(JSON.parse(body)).toMatchObject({
      ok: true,
      data: {
        walkingDistanceMeters: 620,
        walkingDurationSeconds: 480,
        walkingMinutes: 8,
      },
    });
  });

  it("returns an explicit no_route status without fake route facts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: 0, result: { routes: [] } }),
    );
    const baseUrl = await startServer({ serverAk: "test-secret", fetchImpl });

    const response = await fetch(
      `${baseUrl}/api/map/walking-route?originLat=22.5&originLng=114.1&destinationLat=22.6&destinationLng=114.2`,
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      ok: false,
      error: "Walking route provider failed",
      routeStatus: "no_route",
      providerStatus: 0,
    });
    expect(payload).not.toHaveProperty("walkingDistanceMeters");
  });
});
