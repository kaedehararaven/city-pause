import { describe, expect, it, vi } from "vitest";
import { restShowcase } from "./restShowcase";
import { replayData } from "./replayData";
import { replayMultiData } from "./multiReplay";
import { parseUserIntent } from "../recommendation/intent";
import { buildDecisionResult } from "../recommendation/engine";
import { buildMultiWithSupply } from "../route-builder/supplement";

describe("demo-only rest showcase", () => {
  it("keeps one cafe and restores the verified historical dessert pair, without mutating algorithm results or fetching", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    try {
      for (const minutes of [90, 120, 150, 180]) {
        const intent = parseUserIntent({ minutes, activity: "rest", text: "", avoidCost: false, nearby: false });
        const result = await buildMultiWithSupply({ intent, singles: buildDecisionResult(intent, replayData(intent)).recommendations, ...replayMultiData(intent) });
        const before = JSON.stringify(result);
        const display = await restShowcase(result, intent, "compact");
        expect(display.routes).toHaveLength(2);
        expect(display.routes[0]).toBe(result.routes[0]);
        expect(display.routes[1].stops.map(stop => stop.poi.name)).toEqual(["iGELATO意大利手工冰淇淋(北京apm店)", "东城区图书馆王府井书店分馆"]);
        expect(display.routes.every(route => route.totalMinutes <= minutes)).toBe(true);
        expect(display.audit.demoSelection?.historicalDessertValidated).toBe(true);
        expect(JSON.stringify(result)).toBe(before);
        expect(await restShowcase(result, intent, "original")).toBe(result);
        expect(await restShowcase(result, { ...intent, activity: "walk" }, "compact")).toBe(result);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
