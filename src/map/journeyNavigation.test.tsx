import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { navigationUrl } from "./journeyNavigation";
import { fixture } from "../route-builder/fixtures.test-support";
import { JourneyMap } from "./JourneyMap";
import { demoMapPreview } from "../demo/mapPreview";
import { replayData } from "../demo/replayData";
import { parseUserIntent } from "../recommendation/intent";
import { buildDecisionResult } from "../recommendation/engine";

describe("journey navigation", () => {
  it("uses the actual directed endpoints, escapes names and never includes an AK", () => {
    const route = fixture(["book"],90).singles[0].routes[0];
    const url = new URL(navigationUrl(route,"起点 & test","书店 <test>"));
    expect(url.origin).toBe("https://api.map.baidu.com");
    expect(url.searchParams.get("coord_type")).toBe("bd09ll");
    expect(url.searchParams.get("origin")).toContain(`${route.from.location.latitude},${route.from.location.longitude}`);
    expect(url.searchParams.get("destination")).toContain(`${route.to.location.latitude},${route.to.location.longitude}`);
    expect(url.searchParams.has("ak")).toBe(false);
  });
  it("renders missing-geometry fallback and navigation without searching or routing", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    try {
      const html = renderToStaticMarkup(<JourneyMap plan={fixture(["book"],90).singles[0]} />);
      expect(html).toContain("部分路段暂无预览");
      expect(html).toContain("打开百度导航");
      expect(html).toContain("沿途导航");
      expect(html).toContain("journey-leg-number");
      expect(html).toContain("分钟 ·");
      expect(html).toContain('aria-pressed="true">全程');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("overlays saved preview geometry without rewriting historical times or single plans", () => {
    const intent = parseUserIntent({minutes:180,activity:"rest",text:"",avoidCost:false,nearby:false});
    const plan = buildDecisionResult(intent,replayData(intent)).recommendations[0];
    const before = JSON.stringify(plan);
    const preview = demoMapPreview(plan);
    expect(preview.routes[0].geometry?.length).toBeGreaterThan(0);
    expect(preview.totalMinutes).toBe(plan.totalMinutes);
    expect(preview.routes[0].walkingDurationSeconds).toBe(plan.routes[0].walkingDurationSeconds);
    expect(JSON.stringify(plan)).toBe(before);
  });
});
