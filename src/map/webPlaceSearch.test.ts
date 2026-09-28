import { describe, expect, it, vi } from "vitest";
import { createWebPlaceSearch } from "./webPlaceSearch";
import { PlaceDetailError } from "./capabilityClient";

const center = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const };
const pageData = (page: number, count = 20, total = 100) => ({
  total, rawResultCount: count, observedAt: 1, expiresAt: 9999999999999,
  places: Array.from({ length: count }, (_, i) => ({
    source: "baidu-place-v3-search" as const, providerId: `${page}-${i}`, name: "测试地点", location: center,
    classifiedTag: page === 0 ? "美食;咖啡厅" : page === 1 ? "休闲娱乐;茶馆" : "美食;甜品店",
    subPlaces: [], observedFields: [], observedDetailFields: [],
  })),
});

describe("bounded composite Web Search pagination", () => {
  it("reads three pages of the same query and preserves later-page categories", async () => {
    const fetchPage = vi.fn(async (_center, _radius, _keywords, page) => pageData(page));
    const keywords = ["咖啡厅", "茶馆", "甜品店"];
    const result = await createWebPlaceSearch(center, 1500, fetchPage)(keywords, new AbortController().signal);
    expect(fetchPage.mock.calls.map(call => call[3])).toEqual([0, 1, 2]);
    expect(fetchPage.mock.calls.every(call => call[2] === keywords && call[1] === 1500)).toBe(true);
    expect(result).toMatchObject({ rawResultCount: 60, rawResultSetCount: 3, adapterInputCount: 60 });
    if (!("pois" in result)) throw new Error("Missing page results");
    expect(new Set(result.pois.map(p => p.classifiedPoiTag)).size).toBe(3);
  });
  it("stops at a short page and at a provider-reported last page", async () => {
    for (const [count, total] of [[7, 100], [20, 20], [0, 0]]) {
      const fetchPage = vi.fn(async () => pageData(0, count, total));
      await createWebPlaceSearch(center, 1500, fetchPage)(["咖啡厅"], new AbortController().signal);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    }
  });
  it("preserves earlier pages and reports failure without requesting the next page", async () => {
    const fetchPage = vi.fn(async (_center, _radius, _keywords, page) => {
      if (page === 1) throw new PlaceDetailError("provider_302", true);
      return pageData(page);
    });
    const result = await createWebPlaceSearch(center, 1500, fetchPage)(["咖啡厅"], new AbortController().signal);
    expect(result).toMatchObject({ errorCode: "provider_302", rawResultCount: 20, rawResultSetCount: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it("does not request further pages after cancellation", async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async () => { controller.abort(); return pageData(0); });
    await expect(createWebPlaceSearch(center, 1500, fetchPage)(["咖啡厅"], controller.signal)).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
