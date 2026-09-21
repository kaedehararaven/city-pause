import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaiduDiscoverySearch } from "./localSearchDiscovery";
import { DISCOVERY_LIMITS } from "./searchMapping";

const center = { latitude: 39.9, longitude: 116.4, coordinateSystem: "BD-09" as const };
const raw = { uid: "example", title: "示例书店", point: { lat: 39.9, lng: 116.4 }, internal: "not exposed" };
function fixture(status = 0, pois = [raw], neverCompletes = false) {
  const calls = vi.fn();
  const clear = vi.fn();
  let callback: BMap.LocalSearchOptions["onSearchComplete"];
  const result = {
    getNumPois: () => pois.length, getCurrentNumPois: () => pois.length,
    getPoi: (index: number) => pois[index],
  } as unknown as BMap.LocalResult;
  const api = {
    Point: class { constructor(public lng: number, public lat: number) {} },
    LocalSearch: class {
      constructor(_point: unknown, options: BMap.LocalSearchOptions) {
        expect(options.pageCapacity).toBe(5);
        expect(options.renderOptions).toBeUndefined();
        callback = options.onSearchComplete;
      }
      getStatus() { return status; }
      clearResults() { clear(); }
      searchNearby(...args: unknown[]) {
        calls(...args);
        if (!neverCompletes) queueMicrotask(() => callback?.(result));
      }
    },
  } as unknown as typeof BMap;
  return { search: createBaiduDiscoverySearch(api, center), calls, clear, late: () => callback?.(result) };
}
afterEach(() => vi.useRealTimers());

describe("Baidu discovery adapter", () => {
  it("adapts the first page and enforces the radius", async () => {
    const { search, calls } = fixture();
    const result = await search("书店", new AbortController().signal);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0][2]).toBe(1500);
    expect(result).toMatchObject({ status: "success", pois: [{ source: "real", providerId: "example", name: "示例书店" }] });
    expect(JSON.stringify(result)).not.toMatch(/internal|not exposed|"uid"|"title"/);
  });
  it("truncates a provider page to five without issuing another query", async () => {
    const { search, calls } = fixture(0, Array.from({ length: 20 }, () => raw));
    expect(await search("书店", new AbortController().signal)).toMatchObject({ inspectedCount: 5, totalReported: 20 });
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it.each([0, 2])("accepts explicit zero counts with status %s", async status => {
    expect(await fixture(status, []).search("公园", new AbortController().signal)).toMatchObject({ status: "empty" });
  });
  it("does not classify errors as empty", async () => {
    expect(await fixture(7, []).search("公园", new AbortController().signal)).toEqual({ status: "provider_error" });
    expect(await fixture(8, []).search("公园", new AbortController().signal)).toEqual({ status: "timeout" });
  });
  it("rejects arbitrary queries without calling Baidu", async () => {
    const { search, calls } = fixture();
    expect(await search("arbitrary", new AbortController().signal)).toEqual({ status: "provider_error" });
    expect(calls).not.toHaveBeenCalled();
  });
  it("spaces sequential queries by at least 400ms", async () => {
    vi.useFakeTimers();
    const { search, calls } = fixture();
    const signal = new AbortController().signal;
    const first = search("书店", signal);
    await vi.advanceTimersByTimeAsync(0);
    await first;
    const second = search("公园", signal);
    expect(calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(calls).toHaveBeenCalledTimes(2);
  });
  it("times out a missing callback and ignores late completion", async () => {
    vi.useFakeTimers();
    const { search, clear, late } = fixture(0, [raw], true);
    const pending = search("书店", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(DISCOVERY_LIMITS.queryTimeoutMs);
    expect(await pending).toEqual({ status: "timeout" });
    late();
    expect(clear).toHaveBeenCalledTimes(1);
  });
  it("cancels an in-flight search and ignores late completion", async () => {
    const { search, clear, late } = fixture(0, [raw], true);
    const controller = new AbortController();
    const pending = search("书店", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    late();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
