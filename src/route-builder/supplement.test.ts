import { describe, expect, it, vi } from "vitest";
import { buildMultiWithSupply, supplementKeywords, validateSupplement, type SupplementCache } from "./supplement";
import { fixture, mockEdge } from "./fixtures.test-support";
import { buildDecisionResult } from "../recommendation/engine";
import type { MapPOI, RouteResult } from "../contracts/map";
import type { EdgeCache, EdgeRequest } from "./edges";
import { edgeKey } from "./edges";
import type { DiscoverySearch } from "../map/discovery";

// Synthetic contracts marked real solely to exercise real-mode boundaries.
function realFixture() {
  const original = fixture(["art"], 180);
  const places = original.data.places.map(poi => ({ ...poi, source: "real" as const, provider: "baidu" as const }));
  const data = { ...original.data, source: "real" as const, places,
    routes: original.data.routes.map(route => ({ ...route, source: "real" as const, provider: "baidu" as const })),
    discoveredCandidates: original.data.discoveredCandidates!.map((candidate, index) => ({ ...candidate, poi: places[index] })),
  };
  return { intent: original.intent, data, singles: buildDecisionResult(original.intent, data).recommendations };
}
function poi(id: string, tag = "购物;商业街"): MapPOI {
  return { source: "real", provider: "baidu", providerId: id, name: `合成地点${id}`, classifiedPoiTag: tag,
    location: { latitude: 30, longitude: 110.002, coordinateSystem: "BD-09" } };
}
const route = (input: EdgeRequest): RouteResult => ({ ...mockEdge(input), source: "real", provider: "baidu" });

describe("multi-only supplementary candidate supply", () => {
  it("searches absent families using only existing S/M queries, not W or repeated culture", () => {
    const keywords = supplementKeywords(realFixture());
    expect(keywords).toContain("商业街"); expect(keywords).toContain("书店");
    expect(keywords).not.toContain("美术馆"); expect(keywords).not.toContain("咖啡厅"); expect(keywords).not.toContain("公园");
    const input = realFixture();
    expect(supplementKeywords({ ...input, intent: { ...input.intent, availableMinutes: 30 } })).toEqual([]);
    expect(supplementKeywords({ ...input, intent: { ...input.intent, returnMode: "return_to_start" } })).toEqual([]);
  });
  it("one combined search; all new origin and inter-stop calls share budget6; singles stay unchanged", async () => {
    const input = realFixture(), before = JSON.stringify(input);
    const search = vi.fn<DiscoverySearch>(async () => ({ status: "success", totalReported: 2, inspectedCount: 2, pois: [poi("street"), poi("book", "购物;商铺;书店")] }));
    const fetchEdge = vi.fn(async (request: EdgeRequest) => route(request));
    const result = await buildMultiWithSupply({ ...input, search, fetchEdge });
    expect(search).toHaveBeenCalledTimes(1);
    expect(Array.isArray(search.mock.calls[0][0])).toBe(true);
    expect(result.audit.supplement?.addedFeasible).toBe(2);
    expect(result.audit.supplement?.routeRequests).toBe(2);
    expect(result.audit.requests).toBe(fetchEdge.mock.calls.length);
    expect(result.audit.requests).toBeLessThanOrEqual(6);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.audit.familyCounts).toEqual({ culture: 1, commercial: 1, interest: 1 });
    expect(JSON.stringify(input)).toBe(before);
  });
  it("validates true paths, inherits parent paths and retains W only naturally", () => {
    const input = realFixture(), rejected = {};
    const result = validateSupplement([poi("wrong", "教育培训;培训机构;兴趣艺术培训"), poi("missing", ""),
      poi("w", "美食;咖啡厅"), poi("s", "购物;商业街;步行街"), poi("nav", "交通设施;停车场")], input, rejected);
    expect(result.map(candidate => [candidate.poi.providerId, candidate.goalMatch])).toEqual([["w", "W"], ["s", "S"]]);
    expect(rejected).toMatchObject({ not_in_goal_whitelist: 1, classified_tag_missing: 1, navigation_poi: 1 });
  });
  it("deduplicates, caps each tag at5 and preserves independently classified children", () => {
    const input = realFixture();
    const parent = { ...poi("parent", "购物;购物中心"), subPlaces: [
      { providerId: "child", name: "模拟书店", classifiedPoiTag: "购物;商铺;书店", location: poi("child").location },
      { providerId: "entrance", name: "模拟入口", classifiedPoiTag: "出入口", location: poi("entrance").location },
    ] };
    const result = validateSupplement([...Array.from({ length: 9 }, (_, i) => poi(`s${i}`)), poi("s0"), parent], input);
    expect(result.filter(c => c.classifiedPoiTag === "购物;商业街")).toHaveLength(5);
    expect(result.some(c => c.poi.providerId === "child" && c.goalMatch === "M")).toBe(true);
    expect(result.some(c => c.poi.providerId === "entrance")).toBe(false);
  });
  it("reuses resolved supplemental searches and routes; goal or origin change does not reuse the wrong data", async () => {
    const input = realFixture(), supplyCache: SupplementCache = new Map(), cache: EdgeCache = new Map();
    const search = vi.fn<DiscoverySearch>(async () => ({ status: "success", totalReported: 2, inspectedCount: 2, pois: [poi("street"), poi("book", "购物;商铺;书店")] }));
    const fetchEdge = vi.fn(async (request: EdgeRequest) => route(request));
    await buildMultiWithSupply({ ...input, search, fetchEdge, supplyCache, cache });
    const calls = fetchEdge.mock.calls.length;
    const second = await buildMultiWithSupply({ ...input, search, fetchEdge, supplyCache, cache });
    expect(search).toHaveBeenCalledTimes(1);
    expect(second.audit.requests).toBeLessThanOrEqual(6);
    expect(fetchEdge.mock.calls.length - calls).toBe(second.audit.requests);
    expect(new Set(fetchEdge.mock.calls.map(([request]) => edgeKey(request))).size).toBe(fetchEdge.mock.calls.length);
    expect(second.audit.supplement?.cacheHit).toBe(true);
    await buildMultiWithSupply({ ...input, data: { ...input.data, origin: { ...input.data.origin, id: "different-origin" } }, search, supplyCache });
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("stored public facts and recorded directed edges never require network", async () => {
    const input = realFixture(), extra = poi("street");
    const outbound = { from: input.data.origin, to: { id: extra.providerId, location: extra.location }, destinationUid: extra.providerId };
    const edge = { from: input.singles[0].routes[0].to, to: outbound.to, destinationUid: extra.providerId };
    const cache: EdgeCache = new Map();
    for (const request of [outbound, edge]) cache.set(edgeKey(request), { route: route(request) as ReturnType<typeof mockEdge>, expiresAt: Infinity });
    const search = vi.fn();
    const result = await buildMultiWithSupply({ ...input, cache, storedPois: [extra], search });
    expect(result.routes).toHaveLength(1); expect(result.audit.requests).toBe(0); expect(search).not.toHaveBeenCalled();
  });
  it("search errors preserve singles, no fabricated tags or expensive detail fallback", async () => {
    const input = realFixture(), before = JSON.stringify(input);
    const search = vi.fn(async () => ({ status: "provider_error" as const, errorCode: "provider_302" }));
    const fetchEdge = vi.fn();
    const result = await buildMultiWithSupply({ ...input, search, fetchEdge });
    expect(result.audit.supplement?.error).toBe("provider_302");
    expect(fetchEdge).not.toHaveBeenCalled(); expect(JSON.stringify(input)).toBe(before);
  });
  it("mock, short budget and return mode do not run real supplemental search", async () => {
    const search = vi.fn();
    await buildMultiWithSupply({ ...fixture(["art"], 180), search });
    const input = realFixture();
    await buildMultiWithSupply({ ...input, intent: { ...input.intent, availableMinutes: 30 }, search });
    await buildMultiWithSupply({ ...input, intent: { ...input.intent, returnMode: "return_to_start" }, search });
    expect(search).not.toHaveBeenCalled();
  });
});
