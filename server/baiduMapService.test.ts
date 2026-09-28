import { describe, expect, it } from "vitest";

import {
  BaiduProviderError,
  adaptPlaceDetail,
  adaptWalkingRoute,
  safePlaceDetailUrl,
} from "./baiduMapService.js";

describe("adaptWalkingRoute", () => {
  it("retains actual BD09 step paths and rejects malformed geometry without inventing connections", () => {
    const adapted = adaptWalkingRoute({ status: 0, result: { routes: [{ distance: 100, duration: 90,
      steps: [{ path: "116.4,39.9;116.41,39.91", distance: 50, duration: 45 }, { path: "garbage" }, { path: "181,39;116,39" }] }] } });
    expect(adapted.geometry).toEqual([[{ longitude: 116.4, latitude: 39.9, coordinateSystem: "BD-09" }, { longitude: 116.41, latitude: 39.91, coordinateSystem: "BD-09" }]]);
    expect(adapted.walkingDurationSeconds).toBe(90);
  });
  it("keeps provider units and rounds walking minutes upward", () => {
    expect(
      adaptWalkingRoute({
        status: 0,
        result: {
          routes: [
            {
              distance: 875,
              duration: 601,
              steps: [
                {
                  distance: 875,
                  duration: 601,
                  instructions: "向前步行",
                  name: "示例路",
                  path: "not exposed",
                },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      source: "baidu-direction-v2-walking",
      coordinateSystem: "BD-09",
      walkingDistanceMeters: 875,
      walkingDurationSeconds: 601,
      walkingMinutes: 11,
      stepCount: 1,
      observedRouteFields: ["distance:number", "duration:number", "steps:array"],
      observedStepFields: [
        "distance:number",
        "duration:number",
        "instructions:string",
        "name:string",
        "path:string",
      ],
      steps: [
        {
          distanceMeters: 875,
          durationSeconds: 601,
          instruction: "向前步行",
          roadName: "示例路",
        },
      ],
    });
  });

  it("rejects a successful response without a route", () => {
    expect.assertions(2);
    try {
      adaptWalkingRoute({ status: 0, result: { routes: [] } });
    } catch (error) {
      expect(error).toBeInstanceOf(BaiduProviderError);
      expect((error as BaiduProviderError).routeStatus).toBe("no_route");
    }
  });

  it("preserves a provider error status without its raw message", () => {
    try {
      adaptWalkingRoute({ status: 2, message: "raw provider message" });
    } catch (error) {
      expect(error).toBeInstanceOf(BaiduProviderError);
      expect((error as BaiduProviderError).providerStatus).toBe(2);
      expect((error as Error).message).not.toContain("raw provider message");
    }
  });

  it("ignores malformed optional steps and does not invent instructions", () => {
    const route = adaptWalkingRoute({
      status: 0,
      result: {
        routes: [{ distance: 100, duration: 60, steps: [{ distance: "100" }] }],
      },
    });

    expect(route.steps).toBeUndefined();
    expect(route).not.toHaveProperty("straightLineDistanceMeters");
  });
});

describe("adaptPlaceDetail", () => {
  it("keeps bounded child facts and navigation points separate from the main coordinate", () => {
    const child = { uid: "gate", name: "示例北门", classified_poi_tag: "出入口", location: { lat: 30.1, lng: 120.1 }, secret: "not-forwarded" };
    const result = adaptPlaceDetail({ status: 0, result: {
      uid: "parent", name: "示例公园", location: { lat: 30, lng: 120 },
      detail_info: { brand: "品牌", price: "80", best_time: "春秋", detail_url: "http://map.baidu.com/detail?uid=example",
        navi_location: { lat: 30.2, lng: 120.2 }, children: [child, child, { uid: "missing-name" },
          { uid: "bad-point", name: "子地点", location: { lat: 100, lng: 120 } }] },
    } });
    expect(result).toMatchObject({ brand: "品牌", price: "80", bestTime: "春秋", detailUrl: "https://map.baidu.com/detail?uid=example" });
    expect(result.location?.latitude).toBe(30);
    expect(result.navigationLocation?.latitude).toBe(30.2);
    expect(result.subPlaces).toHaveLength(2);
    expect(result.subPlaces?.[0].categories).toEqual(["出入口"]);
    expect(result.subPlaces?.[0]).not.toHaveProperty("secret");
    expect(result.subPlaces?.[1].location).toBeUndefined();
    const many = adaptPlaceDetail({ status: 0, result: { uid: "parent", name: "示例", detail_info: {
      children: Array.from({ length: 50 }, (_, index) => ({ uid: String(index), name: "子地点" })),
    } } });
    expect(many.subPlaces).toHaveLength(20);
  });
  it("rejects unsafe links and absent or malformed extended fields", () => {
    expect(safePlaceDetailUrl("http://api.map.baidu.com/place/detail?uid=example&output=html")).toBe("https://api.map.baidu.com/place/detail?uid=example&output=html");
    for (const url of ["javascript:alert(1)", "https://map.baidu.com.evil.test/", "https://user:pass@map.baidu.com/", "https://map.baidu.com/?ak=example", "https://other.test/", "https://api.map.baidu.com/place/v3/detail"]) {
      expect(safePlaceDetailUrl(url)).toBeUndefined();
    }
    const result = adaptPlaceDetail({ status: 0, result: { uid: "p", name: "示例", detail_info: {
      brand: {}, price: [], best_time: null, children: "invalid", navi_location: { lat: "30", lng: 120 },
    } } });
    expect(result.brand).toBeUndefined(); expect(result.price).toBeUndefined();
    expect(result.subPlaces).toBeUndefined(); expect(result.navigationLocation).toBeUndefined();
  });
  it("adapts documented detail fields", () => {
    expect(
      adaptPlaceDetail({
        status: 0,
        result: {
          uid: "poi-id",
          name: "示例公园",
          location: { lat: 22.5, lng: 114.1 },
          address: "示例地址",
          status: "",
          detail_info: {
            tag: "旅游景点;公园",
            shop_hours: "06:00-22:00",
            overall_rating: "4.6",
          },
        },
      }),
    ).toMatchObject({
      providerId: "poi-id",
      name: "示例公园",
      location: { latitude: 22.5, longitude: 114.1, coordinateSystem: "BD-09" },
      address: "示例地址",
      businessStatus: "normal",
      categoryTag: "旅游景点;公园",
      shopHours: "06:00-22:00",
      overallRating: "4.6",
    });
  });

  it("keeps absent optional facts unknown", () => {
    const detail = adaptPlaceDetail({
      status: 0,
      results: [{ uid: "poi-id", name: "只有必要字段的公园" }],
    });

    expect(detail.shopHours).toBeUndefined();
    expect(detail.price).toBeUndefined();
    expect(detail.indoorFloor).toBeUndefined();
    expect(detail).not.toHaveProperty("free");
    expect(detail).not.toHaveProperty("quiet");
  });

  it("ignores malformed optional fields", () => {
    const detail = adaptPlaceDetail({
      status: 0,
      result: {
        uid: "poi-id",
        name: "示例公园",
        telephone: ["unexpected"],
        detail_info: { overall_rating: 4.6 },
      },
    });

    expect(detail.telephone).toBeUndefined();
    expect(detail.overallRating).toBeUndefined();
  });
});
