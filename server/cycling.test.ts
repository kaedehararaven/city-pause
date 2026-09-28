import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { adaptCyclingRoute, getCyclingRoute } from "./baiduMapService";
import { createAppServer } from "./app";

describe("official Direction v2 ordinary bicycle capability", () => {
  it("adapts only canonical route metrics, not raw provider fields", () => {
    expect(adaptCyclingRoute({ status: 0, result: { routes: [{ distance: 1200, duration: 450, secret: "discard" }] } })).toEqual({
      source: "baidu-direction-v2-riding", mode: "cycling", coordinateSystem: "BD-09", distanceMeters: 1200, durationSeconds: 450, durationMinutes: 7.5,
    });
  });
  it.each([2001, 1, 2, 302])("maps provider status %s without fake route facts", status => {
    try { adaptCyclingRoute({ status, message: "do not echo" }); throw new Error("expected failure"); }
    catch (error) { expect(error).toMatchObject({ routeStatus: status === 2001 ? "no_route" : "provider_error" }); expect(String(error)).not.toContain("do not echo"); }
  });
  it("rejects empty, malformed and nonfinite metrics", () => {
    expect(() => adaptCyclingRoute({ status: 0, result: { routes: [] } })).toThrow();
    for (const duration of [undefined, -1, Infinity, "450"]) expect(() => adaptCyclingRoute({ status: 0, result: { routes: [{ distance: 20, duration }] } })).toThrow();
  });
  it("uses verified riding endpoint, ordinary bicycle and explicit BD09 coordinates server-side", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: 0, result: { routes: [{ distance: 1000, duration: 300 }] } }));
    const result = await getCyclingRoute({ originLatitude: 30, originLongitude: 120, destinationLatitude: 30.01, destinationLongitude: 120.01 }, "synthetic-only", fetcher);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.map.baidu.com/direction/v2/riding");
    expect(url.searchParams.get("riding_type")).toBe("0");
    expect(url.searchParams.get("coord_type")).toBe("bd09ll");
    expect(url.searchParams.get("ret_coordtype")).toBe("bd09ll");
    expect(JSON.stringify(result)).not.toContain("synthetic-only");
  });
  it("sanitizes timeout failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("sensitive request omitted", "TimeoutError"));
    await expect(getCyclingRoute({ originLatitude: 30, originLongitude: 120, destinationLatitude: 30.01, destinationLongitude: 120.01 }, "synthetic-only", fetcher)).rejects.toMatchObject({ routeStatus: "timeout", message: "Baidu request unavailable" });
  });
  it("exposes a fixed validated cycling endpoint with cache and no credential echo", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: 0, result: { routes: [{ distance: 900, duration: 240, debug: "synthetic-only" }] } }));
    const server = createAppServer({ serverAk: "synthetic-only", fetchImpl: fetcher });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(base + "/api/map/cycling-route")).status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
      const path = "/api/map/cycling-route?originLat=30&originLng=120&destinationLat=30.01&destinationLng=120.01";
      const response = await fetch(base + path); const body = await response.text();
      expect(response.status).toBe(200); expect(body).not.toContain("synthetic-only");
      expect(JSON.parse(body).data.mode).toBe("cycling");
      await fetch(base + path); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
