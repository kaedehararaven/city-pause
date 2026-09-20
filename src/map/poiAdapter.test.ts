import { describe, expect, it } from "vitest";

import { adaptBaiduLocalResultPoi } from "./poiAdapter";

describe("adaptBaiduLocalResultPoi", () => {
  it("maps verified Baidu fields into the temporary internal shape", () => {
    const rawPoi = {
      uid: "provider-id",
      title: "示例公园",
      point: { lng: 116.4, lat: 39.9 },
      address: "示例地址",
      phoneNumber: "010-00000000",
      tags: ["公园", " 城市公园 "],
      adcode: 440307,
    } as unknown as BMap.LocalResultPoi;

    expect(adaptBaiduLocalResultPoi(rawPoi)).toEqual({
      source: "baidu-jsapi-local-search",
      providerId: "provider-id",
      name: "示例公园",
      location: {
        longitude: 116.4,
        latitude: 39.9,
        coordinateSystem: "BD-09",
      },
      address: "示例地址",
      telephone: "010-00000000",
      categoryTags: ["公园", "城市公园"],
      adcode: "440307",
    });
  });

  it("keeps absent optional facts unknown instead of inventing values", () => {
    const rawPoi = {
      uid: "provider-id",
      title: "只有必要字段的公园",
      point: { lng: 116.4, lat: 39.9 },
    } as unknown as BMap.LocalResultPoi;

    const adapted = adaptBaiduLocalResultPoi(rawPoi);

    expect(adapted?.telephone).toBeUndefined();
    expect(adapted?.categoryTags).toBeUndefined();
    expect(adapted).not.toHaveProperty("openingHours");
    expect(adapted).not.toHaveProperty("walkingMinutes");
  });

  it("ignores an unexpected runtime shape for optional tags", () => {
    const rawPoi = {
      uid: "provider-id",
      title: "运行时字段形状异常的公园",
      point: { lng: 116.4, lat: 39.9 },
      tags: "公园",
    } as unknown as BMap.LocalResultPoi;

    expect(adaptBaiduLocalResultPoi(rawPoi)?.categoryTags).toBeUndefined();
  });

  it("rejects a result without the provider's required identity or point", () => {
    expect(
      adaptBaiduLocalResultPoi({
        uid: "",
        title: "无有效标识",
        point: { lng: 116.4, lat: 39.9 },
      } as unknown as BMap.LocalResultPoi),
    ).toBeNull();
  });
});
