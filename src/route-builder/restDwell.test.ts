import { describe, expect, it } from "vitest";
import { familyFor, multiStopDwellRange } from "./policy";
import { buildMultiStop } from "./builder";
import { fixture, mockEdge } from "./fixtures.test-support";

describe("rest-only multi-stop dwell exceptions", () => {
  it.each(["美食;咖啡厅", "休闲娱乐;书咖", "休闲娱乐;茶馆", "美食 > 咖啡厅 > 子分类"])("extends %s only for rest without mutating shared ranges", tag => {
    const family = familyFor({ classifiedPoiTag: tag })!;
    expect(multiStopDwellRange(family, "rest")).toEqual({ min: 30, max: 120 });
    expect(multiStopDwellRange(family, "walk")).toEqual({ min: 30, max: 60 });
    expect(multiStopDwellRange(family, "explore")).toEqual({ min: 30, max: 60 });
    expect(family.range).toEqual({ min: 30, max: 60 });
  });

  it.each(["美食;甜品店", "美食;饮品店", "美食;糕点烘焙", "休闲娱乐;猫咖", "购物;商铺;书店", "旅游景点;公园"])("preserves the existing range for %s", tag => {
    const family = familyFor({ classifiedPoiTag: tag })!;
    expect(multiStopDwellRange(family, "rest")).toEqual(family.range);
  });

  it("allocates extended cafe dwell within180min without changing singles or stop count", async () => {
    const input = fixture(["cafe", "book"], 180);
    const before = JSON.stringify(input.singles);
    const result = await buildMultiStop({ ...input, intent: { ...input.intent, activity: "rest", goal: "rest" }, fetchEdge: async r => mockEdge(r, 18 * 60) });
    const route = result.routes[0];
    expect(route.stops).toHaveLength(2);
    expect(route.stops[0].range).toEqual({ min: 30, max: 120 });
    expect(route.exactDwell[0]).toBeGreaterThan(60);
    expect(route.exactDwell[0]).toBeLessThanOrEqual(120);
    expect(route.totalMinutes).toBeLessThanOrEqual(180);
    expect(route.remainingMinutes).toBeLessThan(10);
    expect(JSON.stringify(input.singles)).toBe(before);
  });
});
