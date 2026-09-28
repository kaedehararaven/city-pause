import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MultiStopResults, multiJourney } from "./MultiStopResults";
import { JourneySheet } from "../JourneySheet";
import { buildMultiStop } from "./builder";
import { fixture, mockEdge } from "./fixtures.test-support";

describe("independent multi-stop presentation", () => {
  it("renders a mock route, safe timeline and reusable journey sheet without a single-place strategy", async () => {
    const result = await buildMultiStop({ ...fixture(["book", "shop"], 90), fetchEdge: async request => mockEdge(request, 137) });
    const plan = multiJourney(result.routes[0]);
    expect(plan.steps.reduce((sum, step) => sum + step.minutes, 0)).toBeCloseTo(plan.totalMinutes);
    expect("strategyId" in plan).toBe(false);
    const html = renderToStaticMarkup(<MultiStopResults result={result} loading={false} error="" stale={false} replay={false} onChoose={() => {}} auditEnabled />);
    expect(html).toContain("多地点路线"); expect(html).toContain("MOCK"); expect(html).toContain("2 站");
    expect(html).toContain("就选这条路线"); expect(html).toContain("weakestGoal");
    const sheet = renderToStaticMarkup(<JourneySheet plan={plan} />);
    expect(sheet).toContain("模拟book"); expect(sheet).toContain("模拟shop");
    expect(sheet).toContain("随身小行程");
  });
  it("displays missing replay evidence, not a fake route or provider outage", async () => {
    const result = await buildMultiStop(fixture(["book", "shop"], 90));
    const html = renderToStaticMarkup(<MultiStopResults result={result} loading={false} error="" stale={false} replay onChoose={() => {}} auditEnabled={false} />);
    expect(html).toContain("历史案例暂缺站间路线");
    expect(html).not.toContain("就选这条路线");
  });
  it("rendering and rerendering never call a route or discovery API", async () => {
    const result = await buildMultiStop({ ...fixture(["book", "shop"], 90), fetchEdge: async request => mockEdge(request) });
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    try {
      for (let i = 0; i < 4; i++) {
        const html = renderToStaticMarkup(<MultiStopResults result={result} loading={false} error="" stale={i > 0} replay={false} onChoose={() => {}} auditEnabled={false} />);
        if (i > 0) expect(html).toContain("disabled");
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps failure/loading copy separate from single-place availability", () => {
    const html = renderToStaticMarkup(<MultiStopResults result={null} loading={false} error="route-error" stale={false} replay={false} onChoose={() => {}} auditEnabled={false} />);
    expect(html).toContain("单地点安排不受影响");
  });
});
