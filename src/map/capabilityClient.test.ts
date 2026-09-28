import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCyclingRoute, fetchRequiredRoutes, fetchWalkingRoute, fetchPlaceDetail } from "./capabilityClient";

const location = {
  latitude: 39.9,
  longitude: 116.4,
  coordinateSystem: "BD-09" as const,
};
const input = {
  from: { id: "origin", location },
  to: { id: "poi", location },
  destinationUid: "poi",
};

afterEach(() => vi.unstubAllGlobals());

describe("safe place detail diagnostics", () => {
  it("reports provider refusal without echoing response text or identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, providerStatus: 302, error: "private-upstream-message" }, { status: 502 })));
    await expect(fetchPlaceDetail("test-poi")).rejects.toMatchObject({ code: "provider_302", serviceFailure: true, message: "provider_302" });
  });
  it("distinguishes malformed data and mismatched identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: {} })));
    await expect(fetchPlaceDetail("test-poi")).rejects.toMatchObject({ code: "invalid_response" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: { source: "baidu-place-v3-detail", providerId: "different", name: "synthetic" } })));
    await expect(fetchPlaceDetail("test-poi")).rejects.toMatchObject({ code: "identity_mismatch" });
  });
  it("reports network failures without forwarding arbitrary exception text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("private URL"); }));
    await expect(fetchPlaceDetail("test-poi")).rejects.toMatchObject({ code: "network_unavailable", message: "network_unavailable" });
  });
});

describe("walking RouteResult adapter", () => {
  it("keeps cycling mode, endpoints and failure facts distinct", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ ok: true, data: {
      source: "baidu-direction-v2-riding", mode: "cycling", coordinateSystem: "BD-09", distanceMeters: 900, durationSeconds: 300, durationMinutes: 5,
    } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchCyclingRoute(input);
    expect(result).toMatchObject({ source: "real", provider: "baidu", mode: "cycling", from: input.from, to: input.to, durationSeconds: 300 });
    expect(result).not.toHaveProperty("walkingMinutes");
    expect(fetcher.mock.calls[0][0]).toMatch(/^\/api\/map\/cycling-route\?/);
    fetcher.mockImplementation(async () => Response.json({ ok: false, routeStatus: "no_route" }, { status: 404 }));
    const failure = await fetchCyclingRoute(input);
    expect(failure.status).toBe("no_route"); expect(failure).not.toHaveProperty("durationSeconds");
  });
  it("requests only outbound by default and adds the directed return only on demand", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ok: true,
      data: { coordinateSystem: "BD-09", walkingDistanceMeters: 600, walkingDurationSeconds: 360 },
    }));
    // Each request needs its own response body.
    fetchMock.mockImplementation(async () => Response.json({
      ok: true,
      data: { coordinateSystem: "BD-09", walkingDistanceMeters: 600, walkingDurationSeconds: 360 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const outbound = await fetchRequiredRoutes(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ source: "real", from: input.from, to: input.to });
    const both = await fetchRequiredRoutes(input, "return_to_start", outbound);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(both[1]).toMatchObject({ source: "real", from: input.to, to: input.from });
    expect(await fetchRequiredRoutes(input, "open_ended", both)).toEqual(outbound);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps provider seconds and derives minutes at the shared boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      data: {
        source: "baidu-direction-v2-walking",
        coordinateSystem: "BD-09",
        walkingDistanceMeters: 875,
        walkingDurationSeconds: 601,
        walkingMinutes: 999,
        stepCount: 1,
        observedRouteFields: ["provider-only"],
        observedStepFields: [],
      },
    })));

    await expect(fetchWalkingRoute(input)).resolves.toEqual({
      status: "success",
      source: "real",
      provider: "baidu",
      mode: "walking",
      from: input.from,
      to: input.to,
      coordinateSystem: "BD-09",
      walkingDistanceMeters: 875,
      walkingDurationSeconds: 601,
      walkingMinutes: 11,
      distanceMeters: 875,
      durationSeconds: 601,
      durationMinutes: 601 / 60,
    });
  });

  it("preserves no_route without inventing distance or duration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { ok: false, error: "Walking route provider failed", routeStatus: "no_route" },
      { status: 404 },
    )));

    const result = await fetchWalkingRoute(input);
    expect(result.status).toBe("no_route");
    expect(result).not.toHaveProperty("walkingDistanceMeters");
    expect(result).not.toHaveProperty("walkingDurationSeconds");
  });

  it("maps an unclassified failure to provider_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(fetchWalkingRoute(input)).resolves.toMatchObject({
      status: "provider_error",
      source: "real",
    });
  });
});
