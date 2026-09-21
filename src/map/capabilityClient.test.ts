import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRequiredRoutes, fetchWalkingRoute } from "./capabilityClient";

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

describe("walking RouteResult adapter", () => {
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
