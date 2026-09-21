import { describe, expect, it } from "vitest";

import {
  BaiduProviderError,
  adaptPlaceDetail,
  adaptWalkingRoute,
} from "./baiduMapService.js";

describe("adaptWalkingRoute", () => {
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
