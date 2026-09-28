import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverTimeAware } from "./timeAwareDiscovery";
import { discoveryEnvelope } from "./discoveryEnvelope";
import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchPolicy } from "../contracts/search";

const origin = { id: "test-origin", name: "合成公开区域", location: { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const } };
const policy = (t: number): SearchPolicy => ({ version: "0.1", availableMinutes: t, entries: SEARCH_CATEGORIES.map(category => ({ category, priority: "high", reason: "fixture" })) });
function apiFixture() {
  const calls: { radius: number; query: string }[] = [];
  let active = 0, maximumActive = 0;
  const api = {
    Point: class { constructor(public lng: number, public lat: number) {} },
    LocalSearch: class {
      result?: BMap.LocalResult;
      constructor(_center: unknown, public options: BMap.LocalSearchOptions) {}
      getStatus() { return 0; }
      clearResults() {}
      searchNearby(query: string, _center: unknown, radius: number) {
        calls.push({ query, radius }); active++; maximumActive = Math.max(maximumActive, active);
        const pois = Array.from({ length: 5 }, (_, i) => ({ uid: `${query}-${radius}-${i}`, title: "合成地点", point: { lat: 30, lng: 120 } }));
        queueMicrotask(() => { active--; this.options.onSearchComplete?.({ getNumPois: () => 5, getCurrentNumPois: () => 5, getPoi: (i: number) => pois[i] } as unknown as BMap.LocalResult); });
      }
    },
  } as unknown as typeof BMap;
  return { api, calls, maximumActive: () => maximumActive };
}
afterEach(() => vi.useRealTimers());
describe("B3 nested discovery envelopes", () => {
  it("preserves near supply, expands the query envelope and bounds calls serially", async () => {
    vi.useFakeTimers();
    const f = apiFixture(); const signal = new AbortController().signal;
    const smallTask = discoverTimeAware(f.api, origin, policy(15), "walking", signal);
    await vi.runAllTimersAsync(); const small = await smallTask;
    expect(f.calls).toHaveLength(7);
    const largeTask = discoverTimeAware(f.api, origin, policy(60), "walking", signal);
    await vi.runAllTimersAsync(); const large = await largeTask;
    expect(f.calls).toHaveLength(21); expect(f.maximumActive()).toBe(1);
    expect(large.result.candidates).toHaveLength(28);
    expect(new Set(large.result.candidates.flatMap(c => c.matchedSearchCategories)).size).toBe(7);
    expect(new Set(f.calls.slice(7).map(c => c.radius))).toEqual(new Set([discoveryEnvelope(15).radiusMeters, discoveryEnvelope(60).radiusMeters]));
    expect(new Set(large.result.candidates.flatMap(c => c.matchedSearchCategories)).size).toBe(7);
  });
  it("uses the cycling envelope explicitly and makes no calls for empty policy", async () => {
    vi.useFakeTimers();
    const f = apiFixture(); const signal = new AbortController().signal;
    const task = discoverTimeAware(f.api, origin, policy(30), "cycling", signal);
    await vi.runAllTimersAsync(); const result = await task;
    expect(result.envelope?.mode).toBe("cycling");
    expect(Math.max(...f.calls.map(c => c.radius))).toBe(discoveryEnvelope(30, "cycling").radiusMeters);
    const count = f.calls.length;
    await discoverTimeAware(f.api, origin, { ...policy(60), entries: [] }, "cycling", signal);
    expect(f.calls).toHaveLength(count);
  });
});
