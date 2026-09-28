import { describe, expect, it, vi } from "vitest";
import { adaptPlaceSearch, getPlaceAround, getPlaceDetails } from "./baiduMapService";
const item = (uid: string) => ({ uid, name: "测试地点", location: { lat: 30, lng: 120 }, detail_info: { classified_poi_tag: "美食;咖啡厅", overall_rating: "4.7", price: "25", brand: "示例", parent_id: "parent" } });
describe("Web Search V3 and batch details", () => {
  it("reads every Search result and preserves classified provenance and optional fields", () => {
    const data = adaptPlaceSearch({ status: 0, total: 2, results: [item("a"), item("b")] });
    expect(data.places).toHaveLength(2);
    expect(data.places[0]).toMatchObject({ source: "baidu-place-v3-search", classifiedTag: "美食;咖啡厅", overallRating: "4.7", price: "25", parentId: "parent" });
  });
  it("sends one dollar-separated query with scope=2 and explicit BD09 input", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/place/v3/around");
      expect(parsed.searchParams.get("query")).toBe("咖啡厅$甜品店");
      expect(parsed.searchParams.get("scope")).toBe("2");
      expect(parsed.searchParams.get("coord_type")).toBe("3");
      expect(parsed.searchParams.get("page_size")).toBe("20");
      expect(parsed.searchParams.get("page_num")).toBe("2");
      return Response.json({ status: 0, results: [item("a")] });
    });
    await getPlaceAround({ keywords: ["咖啡厅", "甜品店"], latitude: 30, longitude: 120, radius: 1500, page: 2 }, "fake-test-key", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("adapts all batch results and ignores unrequested identities", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(new URL(String(url)).searchParams.get("uids")).toBe("a,b");
      return Response.json({ status: 0, results: [item("b"), item("a"), item("unrequested")] });
    });
    expect((await getPlaceDetails(["a", "b"], "fake-test-key", fetcher)).map(p => p.providerId)).toEqual(["b", "a"]);
  });
});
