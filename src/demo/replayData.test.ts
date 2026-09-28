import { describe, expect, it, vi } from "vitest";
import { replayData, replayCapture } from "./replayData";
import { parseUserIntent } from "../recommendation/intent";
import { buildDecisionResult } from "../recommendation/engine";

describe("captured public v3 demo", () => {
  it("recomputes all goals and budgets offline using real captured routes and strict feasibility", () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(replayCapture.routes.length).toBeGreaterThanOrEqual(65);
      for (const activity of ["rest", "walk", "explore"] as const) for (const minutes of [30, 45, 60, 90, 120, 150, 180]) {
        const intent = parseUserIntent({ minutes, activity, text: "", avoidCost: false, nearby: false });
        const data = replayData(intent);
        expect(data.places.length).toBeGreaterThan(0);
        const tags = data.discoveredCandidates!.map(candidate => candidate.classifiedPoiTag);
        expect(tags.every(tag => tags.filter(value => value === tag).length <= 5)).toBe(true);
        expect(data.discoveredCandidates?.every(p => p.classifiedPoiTag && p.tagValidation === "matched")).toBe(true);
        const result = buildDecisionResult(intent, data);
        expect(result.recommendations.every(r => r.totalMinutes <= minutes + 0.000001 && r.goalMatch)).toBe(true);
        expect(result.recommendations.length).toBe(result.candidates.length);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("never fabricates return routes", () => {
    const intent = parseUserIntent({ minutes: 60, activity: "rest", text: "", avoidCost: false, nearby: false, returnMode: "return_to_start" });
    expect(() => replayData(intent)).toThrow("未采集返程");
  });
});
