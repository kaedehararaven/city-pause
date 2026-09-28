import { describe, expect, it } from "vitest";
import { buildRecommendations } from "./engine";
import { createMockCandidateData } from "./mock";
import { parseUserIntent } from "./intent";
const intent = (minutes = 30) => parseUserIntent({ minutes, activity: "auto", text: "", avoidCost: false, nearby: false });
describe("simple recommendation architecture", () => {
  it("returns one list rather than three strategy lists", () => {
    const plans = buildRecommendations(intent(60), createMockCandidateData());
    expect(plans.every(plan => plan.strategyId === "default")).toBe(true);
    expect(new Set(plans.map(plan => plan.places[0].providerId)).size).toBe(plans.length);
  });
  it("does not require a return route in open-ended mode", () => {
    const data = createMockCandidateData();
    data.routes = data.routes.filter(route => route.from.id === data.origin.id);
    expect(buildRecommendations(intent(), data).length).toBeGreaterThan(0);
  });
  it("uses the 120 percent travel gate", () => {
    const plans = buildRecommendations(intent(30), createMockCandidateData());
    expect(plans.every(plan => plan.travelDurationSeconds <= 30 * 60 / 4 * 1.2)).toBe(true);
  });
});
