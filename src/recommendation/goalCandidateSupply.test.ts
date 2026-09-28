import { describe, expect, it, vi } from "vitest";
import type { MapPOI, MapSubPlace } from "../contracts/map";
import { parseUserIntent } from "./intent";
import { buildGoalSupplyPolicy, compositeGoalQuery, discoverGoalCandidates } from "./goalCandidateSupply";
import { PlaceDetailError } from "../map/capabilityClient";

const poi = (id: string, name = id): MapPOI => ({
  source: "real", provider: "baidu", providerId: id, name,
  location: { latitude: 30, longitude: 120, coordinateSystem: "BD-09" },
});
const detail = (item: MapPOI, tag: string, children: MapSubPlace[] = []) => ({
  source: "baidu-place-v3-detail" as const, providerId: item.providerId, name: item.name,
  classifiedTag: tag, subPlaces: children, observedFields: [], observedDetailFields: [],
});
const intent = (activity: "rest" | "walk" | "explore") => parseUserIntent({ minutes: 30, activity, text: "", avoidCost: false, nearby: false });
const restTag = (i: number) => ["美食 > 咖啡厅", "休闲娱乐 > 茶馆", "美食 > 饮品店"][Math.floor(i / 5)];

describe("Goal-driven Candidate Supply v3", () => {
  it("caps normalized tags across S/M, deduplicates before capacity, and triggers M after capping", async () => {
    const cafes = Array.from({ length: 20 }, (_, i) => ({ ...poi(`cafe-${i}`), classifiedPoiTag: i % 2 ? "美食;咖啡厅" : "美食 > 咖啡厅" }));
    const search = vi.fn().mockResolvedValueOnce({ status: "success", pois: [cafes[0], ...cafes], totalReported: 21, inspectedCount: 21 })
      .mockResolvedValueOnce({ status: "success", pois: [...cafes, ...Array.from({ length: 8 }, (_, i) => ({ ...poi(`tea-${i}`), classifiedPoiTag: "休闲娱乐;茶馆" }))], totalReported: 28, inspectedCount: 28 });
    const loadDetail = vi.fn();
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail });
    expect(result.sCount).toBe(5);
    expect(result.mTriggered).toBe(true);
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates.filter(c => c.poi.providerId.startsWith("cafe-"))).toHaveLength(5);
    expect(result.reports[0].dedupeCount).toBe(1);
    expect(result.reports[0].reasons.tag_capacity_reached).toBe(15);
    expect(loadDetail).not.toHaveBeenCalled();
  });
  it("preserves classified results on a later-page error without starting M or Detail", async () => {
    const search = vi.fn(async () => ({ status: "success" as const, errorCode: "provider_302", pois: [{ ...poi("cafe"), classifiedPoiTag: "美食;咖啡厅" }], totalReported: 40, inspectedCount: 1 }));
    const loadDetail = vi.fn();
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail });
    expect(result.candidates).toHaveLength(1);
    expect(result.serviceError).toBe("provider_302");
    expect(result.mTriggered).toBe(false);
    expect(result.reports[0].status).toBe("provider_error");
    expect(loadDetail).not.toHaveBeenCalled();
  });
  it("does not request any detail when Search already supplies twelve valid candidates", async () => {
    const search = vi.fn(async () => ({ status: "success" as const, pois: [...Array.from({ length: 12 }, (_, i) => ({ ...poi(`valid-${i}`), classifiedPoiTag: restTag(i) })), poi("missing")], totalReported: 13, inspectedCount: 13 }));
    const loadDetails = vi.fn(), loadDetail = vi.fn();
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail, loadDetails });
    expect(result.sCount).toBe(12);
    expect(search).toHaveBeenCalledTimes(1);
    expect(loadDetails).not.toHaveBeenCalled(); expect(loadDetail).not.toHaveBeenCalled();
  });
  it("rescues only absent tags in batches and stops as soon as twelve valid candidates exist", async () => {
    const search = vi.fn(async () => ({ status: "success" as const, pois: [
      ...Array.from({ length: 11 }, (_, i) => ({ ...poi(`valid-${i}`), classifiedPoiTag: restTag(i) })),
      { ...poi("wrong"), classifiedPoiTag: "教育培训 > 培训机构" }, ...Array.from({ length: 15 }, (_, i) => poi(`missing-${i}`)),
    ], totalReported: 27, inspectedCount: 27 }));
    const loadDetails = vi.fn(async (items: MapPOI[]) => ({ places: items.map(item => detail(item, "美食 > 甜品店")) }));
    const loadDetail = vi.fn();
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail, loadDetails });
    expect(result.sCount).toBe(16); expect(result.mTriggered).toBe(false);
    expect(loadDetails).toHaveBeenCalledTimes(1); expect(loadDetails.mock.calls[0][0]).toHaveLength(10);
    expect(loadDetails.mock.calls[0][0].every(p => p.providerId.startsWith("missing-"))).toBe(true);
    expect(loadDetail).not.toHaveBeenCalled();
  });
  it("does not spend another LocalSearch action after S provider failure", async () => {
    const search = vi.fn(async () => ({ status: "provider_error" as const }));
    const loadDetail = vi.fn();
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail });
    expect(search).toHaveBeenCalledTimes(1);
    expect(loadDetail).not.toHaveBeenCalled();
    expect(result.mTriggered).toBe(false);
    expect(result.serviceError).toBe("search_provider_error");
  });
  it("stops on a service refusal, preserves verified candidates, and does not expand to M", async () => {
    const search = vi.fn(async () => ({ status: "success" as const, pois: [poi("ok"), poi("fail"), poi("unused")], totalReported: 3, inspectedCount: 3 }));
    const loadDetail = vi.fn(async (item: MapPOI) => {
      if (item.providerId !== "ok") throw new PlaceDetailError("provider_302", true);
      return detail(item, "美食 > 咖啡厅");
    });
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail });
    expect(search).toHaveBeenCalledTimes(1);
    expect(loadDetail).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.serviceError).toBe("provider_302");
    expect(result.mTriggered).toBe(false);
    expect(result.reports[0].reasons).toEqual({ detail_provider_302: 1, classification_rescue_skipped: 1 });
  });
  it("distinguishes absent classification from a whitelist mismatch", async () => {
    const search = async () => ({ status: "success" as const, pois: [poi("missing"), poi("wrong")], totalReported: 2, inspectedCount: 2 });
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy: buildGoalSupplyPolicy(intent("rest")), search, loadDetail: async item => detail(item, item.providerId === "missing" ? "" : "教育培训 > 培训机构") });
    expect(result.reports[0].reasons).toEqual({ classified_tag_missing: 1, not_in_goal_whitelist: 1 });
    expect(result.serviceError).toBeUndefined();
  });
  it("uses goal-owned S/M rules and one composite search per layer", async () => {
    const policy = buildGoalSupplyPolicy(intent("rest"));
    const calls: (string | string[])[] = [];
    const search = vi.fn(async (query: string | string[]) => {
      calls.push(query);
      return { status: "success" as const, pois: [poi(calls.length === 1 ? "s" : "m")], totalReported: 1, inspectedCount: 1 };
    });
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy, search, loadDetail: async item => detail(item, item.providerId === "s" ? "美食 > 咖啡厅" : "购物 > 商铺 > 书店") });
    expect(calls).toEqual([compositeGoalQuery(policy.s), compositeGoalQuery(policy.m)]);
    expect(result.mTriggered).toBe(true);
    expect(result.reports).toHaveLength(2);
  });

  it("does not call M after twelve valid S candidates", async () => {
    const policy = buildGoalSupplyPolicy(intent("walk"));
    const search = vi.fn(async () => ({ status: "success" as const, pois: Array.from({ length: 12 }, (_, i) => poi(`s-${i}`)), totalReported: 12, inspectedCount: 12 }));
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy, search, loadDetail: async item => detail(item, ["旅游景点 > 公园 > 生态公园", "旅游景点 > 公园 > 城市公园", "购物 > 商业街"][Math.floor(Number(item.providerId.split("-")[1]) / 5)]) });
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.sCount).toBe(12);
    expect(result.mTriggered).toBe(false);
  });

  it("validates the actual classified path, inherits parents, and rejects unknown categories", async () => {
    const policy = buildGoalSupplyPolicy(intent("walk"));
    const search = async () => ({ status: "success" as const, pois: [poi("park"), poi("wrong")], totalReported: 2, inspectedCount: 2 });
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy, search, loadDetail: async item => detail(item, item.providerId === "park" ? "旅游景点 > 公园 > 生态公园" : "教育培训 > 培训机构 > 兴趣艺术培训") });
    expect(result.candidates.map(item => item.poi.providerId)).toContain("park");
    expect(result.candidates.map(item => item.poi.providerId)).not.toContain("wrong");
    expect(result.candidates.find(item => item.poi.providerId === "park")?.goalMatch).toBe("S");
  });

  it("never actively searches W, but keeps a naturally returned W candidate", async () => {
    const policy = buildGoalSupplyPolicy(intent("walk"));
    const search = vi.fn(async () => ({ status: "success" as const, pois: [poi("cafe")], totalReported: 1, inspectedCount: 1 }));
    const result = await discoverGoalCandidates({ origin: { location: poi("origin").location }, policy, search, loadDetail: async item => detail(item, "美食 > 咖啡厅") });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.candidates[0]).toMatchObject({ goalMatch: "W", sourceLayer: "W-natural" });
  });

  it("deduplicates POIs and filters navigation children while keeping meaningful children", async () => {
    const policy = buildGoalSupplyPolicy(intent("rest"));
    const parent = poi("parent");
    const search = async () => ({ status: "success" as const, pois: [parent, parent], totalReported: 2, inspectedCount: 2 });
    const result = await discoverGoalCandidates({ origin: { location: parent.location }, policy, search, loadDetail: async item => detail(item, "旅游景点 > 公园", [
      { providerId: "gate", name: "北门", classifiedPoiTag: "出入口", categories: ["出入口"], location: parent.location },
      { providerId: "book", name: "书店", classifiedPoiTag: "购物 > 商铺 > 书店", categories: ["购物 > 商铺 > 书店"], location: parent.location },
    ]) });
    expect(result.candidates.map(item => item.poi.providerId)).toContain("book");
    expect(result.candidates.map(item => item.poi.providerId)).not.toContain("gate");
    expect(new Set(result.candidates.map(item => item.poi.providerId)).size).toBe(result.candidates.length);
  });
});
