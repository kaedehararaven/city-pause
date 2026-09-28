import { describe, expect, it } from "vitest";
import { recommendationAudit } from "./audit";
import { buildDecisionResult } from "./engine";
import { parseUserIntent } from "./intent";
import { createRealCandidateData } from "./realProvider";

describe("development matrix audit", () => {
  it("retains exact provider seconds, goal fallback and UI decision without endpoint data", () => {
    const location = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const };
    const origin = { id: "private-origin-id", name: "公开测试起点", location };
    const data = createRealCandidateData({ origin, discoveredCandidates: [{
      poi: { providerId: "private-poi-id", source: "real", provider: "baidu", name: "测试咖啡店", location },
      matchedSearchCategories: ["cafe"], discoveryPriority: "high",
    }], routes: [{ status: "success", source: "real", provider: "baidu", coordinateSystem: "BD-09", mode: "walking",
      from: origin, to: { id: "private-poi-id", location }, walkingDistanceMeters: 180, walkingDurationSeconds: 156, walkingMinutes: 3 }] });
    const intent = parseUserIntent({ minutes: 30, activity: "walk", text: "", avoidCost: false, nearby: false });
    const audit = recommendationAudit(intent, data, buildDecisionResult(intent, data));
    expect(audit.candidates[0]).toMatchObject({ seconds: 156, meters: 180, need: null, match: "UNKNOWN", feasible: true, pareto: null, paretoEnabled: false, final: true });
    expect(audit.ui[0]).toMatchObject({ minutes: 2.6, degraded: false });
    expect(JSON.stringify(audit)).not.toMatch(/private-poi-id|private-origin-id|latitude|longitude|providerId/);
  });
});
