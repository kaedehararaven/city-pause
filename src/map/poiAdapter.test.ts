import { describe, expect, it } from "vitest";

import { adaptBaiduLocalResultPoi, mergeBaiduPlaceDetail } from "./poiAdapter";

describe("Baidu MapPOI adapter", () => {
  it("removes provider highlighting before splitting category text", () => {
    const adapted = adaptBaiduLocalResultPoi({
      uid: "example", title: "示例地点", point: { lat: 39.9, lng: 116.4 },
      tags: ['<font color="#c60a00">购物</font>;综合商场;<font color="#c60a00">购物中心</font>'],
    } as unknown as BMap.LocalResultPoi);
    expect(adapted?.categories).toEqual(["购物", "综合商场", "购物中心"]);
  });
  it("rejects invalid coordinate ranges and non-string identities", () => {
    expect(adaptBaiduLocalResultPoi({
      uid: "example", title: "示例", point: { lat: 91, lng: 116.4 },
    } as unknown as BMap.LocalResultPoi)).toBeNull();
    expect(adaptBaiduLocalResultPoi({
      uid: 123, title: "示例", point: { lat: 39.9, lng: 116.4 },
    } as unknown as BMap.LocalResultPoi)).toBeNull();
  });
  it("maps verified Baidu fields into canonical MapPOI v0.1", () => {
    const rawPoi = {
      uid: "provider-id",
      title: "示例公园",
      point: { lng: 116.4, lat: 39.9 },
      address: "示例地址",
      tags: ["公园", " 城市公园 "],
      provider_internal: "must-not-leak",
    } as unknown as BMap.LocalResultPoi;

    expect(adaptBaiduLocalResultPoi(rawPoi)).toEqual({
      source: "real",
      provider: "baidu",
      providerId: "provider-id",
      name: "示例公园",
      location: {
        longitude: 116.4,
        latitude: 39.9,
        coordinateSystem: "BD-09",
      },
      address: "示例地址",
      categories: ["公园", "城市公园"],
    });
  });

  it("keeps absent optional facts unknown and excludes route/raw fields", () => {
    const adapted = adaptBaiduLocalResultPoi({
      uid: "provider-id",
      title: "只有必要字段的公园",
      point: { lng: 116.4, lat: 39.9 },
    } as unknown as BMap.LocalResultPoi);

    expect(adapted?.address).toBeUndefined();
    expect(adapted?.categories).toBeUndefined();
    expect(adapted?.openingHours).toBeUndefined();
    expect(adapted?.rating).toBeUndefined();
    expect(adapted).not.toHaveProperty("walkingMinutes");
    expect(adapted).not.toHaveProperty("provider_internal");
    expect(adapted).not.toHaveProperty("isFree");
  });

  it("merges only supported optional Place Detail facts", () => {
    const base = adaptBaiduLocalResultPoi({
      uid: "provider-id",
      title: "示例地点",
      point: { lng: 116.4, lat: 39.9 },
    } as unknown as BMap.LocalResultPoi)!;

    const merged = mergeBaiduPlaceDetail(base, {
      source: "baidu-place-v3-detail",
      providerId: "provider-id",
      name: "示例地点",
      categoryTag: "旅游景点;公园",
      classifiedTag: "生态公园",
      shopHours: "00:00-24:00",
      overallRating: "4.0",
      price: undefined,
      observedFields: [],
      observedDetailFields: [],
    });

    expect(merged.categories).toEqual(["旅游景点", "公园", "生态公园"]);
    expect(merged.openingHours).toBe("00:00-24:00");
    expect(merged.rating).toBe(4);
    expect(merged).not.toHaveProperty("price");
  });

  it("ignores malformed optional fields and mismatched detail identity", () => {
    const rawPoi = {
      uid: "provider-id",
      title: "运行时字段形状异常的公园",
      point: { lng: 116.4, lat: 39.9 },
      tags: "公园",
    } as unknown as BMap.LocalResultPoi;
    const base = adaptBaiduLocalResultPoi(rawPoi)!;

    expect(base.categories).toBeUndefined();
    expect(mergeBaiduPlaceDetail(base, {
      source: "baidu-place-v3-detail",
      providerId: "other-id",
      name: "其他地点",
      observedFields: [],
      observedDetailFields: [],
    })).toBe(base);
  });

  it("rejects a result without required identity or point", () => {
    expect(adaptBaiduLocalResultPoi({
      uid: "",
      title: "无有效标识",
      point: { lng: 116.4, lat: 39.9 },
    } as unknown as BMap.LocalResultPoi)).toBeNull();
  });
});
