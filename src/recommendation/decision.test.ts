import { describe, expect, it } from "vitest";
import { buildDecisionResult } from "./engine";
import { createMockCandidateData } from "./mock";
import { parseUserIntent } from "./intent";
const intent = parseUserIntent({ minutes: 30, activity: "auto", text: "", avoidCost: false, nearby: false });
describe("ordering without Pareto", () => {
  it("does not create a winner from unknown dimensions", () => {
    const result = buildDecisionResult(intent, createMockCandidateData());
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.candidates.every(item => item.trace.goalMatch.degraded === false)).toBe(true);
  });
  it("is deterministic under input reversal", () => {
    const data = createMockCandidateData();
    const a = buildDecisionResult(intent, data).recommendations.map(p => p.id);
    const b = buildDecisionResult(intent, { ...data, places: [...data.places].reverse(), routes: [...data.routes].reverse() }).recommendations.map(p => p.id);
    expect(a).toEqual(b);
  });
  it("retains incomparable candidates", () => {
    const result = buildDecisionResult(intent, createMockCandidateData());
    expect(result.recommendations.length).toBe(result.candidates.length);
  });
});
