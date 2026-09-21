import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MapPOI } from "../contracts/map";
import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchPolicy } from "../contracts/search";
import { discoverCandidates } from "./discovery";
import type { DiscoveryQueryResult } from "./discovery";
import { baiduQueryFor, BAIDU_SEARCH_QUERIES, DISCOVERY_LIMITS } from "./searchMapping";
import { buildSearchPolicy } from "../recommendation/searchPolicy";
import { parseUserIntent } from "../recommendation/intent";

const center = { latitude: 39.9, longitude: 116.4, coordinateSystem: "BD-09" as const };
const policy: SearchPolicy = {
  version: "0.1", availableMinutes: 30,
  entries: SEARCH_CATEGORIES.map(category => ({ category, priority: "high", reason: "test" })),
};
const poi = (id: string): MapPOI => ({
  source: "real", provider: "baidu", providerId: id, name: "同名地点", location: center,
});
const success = (pois: MapPOI[]): DiscoveryQueryResult => ({
  status: pois.length ? "success" : "empty", pois, inspectedCount: pois.length, totalReported: pois.length,
});

describe("B2 candidate discovery", () => {
  it("keeps lower tiers in browsing and walking pools deterministically", async () => {
    for (const activity of ["explore", "walk"] as const) {
      const intent = parseUserIntent({ minutes: 30, activity, text: "", avoidCost: false, nearby: false });
      const input = { center, policy: buildSearchPolicy(intent) };
      const search = async (query: string) => success(Array.from({ length: 5 }, (_, i) => poi(query + i)));
      const result = await discoverCandidates(input, search);
      expect(result).toEqual(await discoverCandidates(input, search));
      expect(new Set(result.candidates.flatMap(candidate => candidate.matchedSearchCategories))).toEqual(new Set(SEARCH_CATEGORIES));
      expect(result.categories.map(category => category.retainedCount)).toEqual(
        activity === "walk" ? [3, 1, 1, 1, 1] : [3, 2, 2, 2, 1]);
    }
  });

  it("maps all five categories and refuses unknown queries", async () => {
    expect(SEARCH_CATEGORIES.map(baiduQueryFor)).toEqual(["书店", "购物中心", "咖啡厅", "甜品店", "公园"]);
    for (const invalid of ["unknown", "__proto__", "https://example.com", null]) expect(baiduQueryFor(invalid)).toBeUndefined();
    const search = vi.fn();
    await expect(discoverCandidates({ center, policy: { ...policy, entries: [
      { category: "unknown", priority: "high", reason: "" },
    ] } as unknown as SearchPolicy }, search)).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });

  it("orders by priority, allocates 3/2/1 new candidates and preserves input", async () => {
    const input: SearchPolicy = { ...policy, entries: [
      { category: "park", priority: "low", reason: "" },
      { category: "cafe", priority: "medium", reason: "" },
      { category: "mall", priority: "high", reason: "" },
    ] };
    const before = structuredClone(input);
    const search = vi.fn(async (query: string) => success(Array.from({ length: 5 }, (_, i) => poi(query + i))));
    const result = await discoverCandidates({ center, policy: input }, search);
    expect(search.mock.calls.map(call => call[0])).toEqual(["购物中心", "咖啡厅", "公园"]);
    expect(result.categories.map(report => report.retainedCount)).toEqual([3, 2, 1]);
    expect(input).toEqual(before);
    expect(result.candidates.every(candidate => candidate.poi.source === "real")).toBe(true);
  });

  it("caps the pool at 10, performs at most five serial queries, and does not page", async () => {
    let active = 0;
    const search = vi.fn(async (query: string) => {
      active++;
      expect(active).toBe(1);
      await Promise.resolve();
      active--;
      return success(Array.from({ length: 20 }, (_, i) => poi(query + i)));
    });
    const result = await discoverCandidates({ center, policy }, search);
    expect(search).toHaveBeenCalledTimes(5);
    expect(result.candidates).toHaveLength(DISCOVERY_LIMITS.poolSize);
    expect(new Set(result.candidates.flatMap(candidate => candidate.matchedSearchCategories)).size).toBe(5);
    expect(result.categories.every(report => report.validCount <= 5)).toBe(true);
  });

  it("deduplicates identity, not name, and keeps categories separate from provider facts", async () => {
    const shared = { ...poi("shared"), categories: ["真实供应商标签"] };
    const result = await discoverCandidates({ center, policy }, async query =>
      success([shared, shared, poi(query)]));
    const matches = result.candidates.filter(candidate => candidate.poi.providerId === "shared");
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedSearchCategories).toEqual([...SEARCH_CATEGORIES]);
    expect(matches[0].poi.categories).toEqual(["真实供应商标签"]);
    expect(matches[0].discoveryPriority).toBe("high");
    expect(result.candidates).toHaveLength(6);
    expect(shared).not.toHaveProperty("matchedSearchCategories");
  });

  it("retains provenance after the pool fills", async () => {
    const result = await discoverCandidates({ center, policy }, async query => success(
      query === BAIDU_SEARCH_QUERIES.park ? [poi("书店0")] :
        Array.from({ length: 5 }, (_, i) => poi(query + i)),
    ));
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates[0].matchedSearchCategories).toEqual(["bookstore", "park"]);
  });

  it("preserves optional absence and rejects mock or invalid location data", async () => {
    const result = await discoverCandidates({ center, policy }, async () => success([
      poi("valid"), { ...poi("mock"), source: "mock", provider: "mock" },
      { ...poi("bad"), location: { ...center, latitude: 91 } },
    ]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].poi).not.toHaveProperty("categories");
    expect(result.candidates[0].poi).not.toHaveProperty("address");
    expect(result.candidates[0].poi).not.toHaveProperty("isFree");
    expect(result.candidates[0].poi).not.toHaveProperty("walkingMinutes");
  });

  it("supports partial success, zero results, timeout and sanitized thrown failures", async () => {
    const result = await discoverCandidates({ center, policy }, async query => {
      if (query === "书店") return success([poi("book")]);
      if (query === "购物中心") return success([]);
      if (query === "咖啡厅") return { status: "timeout" };
      if (query === "甜品店") throw new Error("private provider error");
      return { status: "provider_error" };
    });
    expect(result.status).toBe("partial_success");
    expect(result.candidates).toHaveLength(1);
    expect(result.categories.map(report => report.status)).toEqual(["success", "empty", "timeout", "provider_error", "provider_error"]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect((await discoverCandidates({ center, policy }, async () => ({ status: "provider_error" }))).status).toBe("error");
    expect((await discoverCandidates({ center, policy }, async () => success([]))).status).toBe("empty");
  });

  it("does not expand empty policies or continue an aborted request", async () => {
    const search = vi.fn(async () => success([]));
    expect((await discoverCandidates({ center, policy: { ...policy, entries: [] } }, search)).status).toBe("empty");
    expect(search).not.toHaveBeenCalled();
    const controller = new AbortController();
    const cancelled = vi.fn(async () => { controller.abort(); return success([poi("late")]); });
    await expect(discoverCandidates({ center, policy }, cancelled, controller.signal)).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("has no route requests and exposes only internal contracts to A", () => {
    for (const file of ["discovery.ts", "localSearchDiscovery.ts", "DiscoveryPanel.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/fetchWalkingRoute|fetchRequiredRoutes|fetchPlaceDetail|capabilityClient/);
    }
    for (const file of ["../contracts/discovery.ts", "../recommendation/searchPolicy.ts"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(/BMap|LocalResultPoi|\.uid|\.title/);
    }
  });
});
