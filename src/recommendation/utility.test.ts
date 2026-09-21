import { describe, expect, it } from "vitest";
import type { DiscoveredCandidate } from "../contracts/discovery";
import type { MapLocation, RouteResult } from "../contracts/map";
import type { SearchCategory } from "../contracts/search";
import { parseUserIntent } from "./intent";
import { createRealCandidateData } from "./realProvider";
import { buildRecommendations } from "./engine";
import { activityBenefit, mobilityBurden, preferenceMatch, qualityGate, scorePlan, selectDiverse, utilityScore } from "./utility";
import type { ScoredPlan } from "./utility";

// Synthetic fixtures exercise the REAL contract; they are not live map evidence.
const location: MapLocation = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" };
const origin = { id: "origin", name: "测试起点", location };
const intent = (activity: "auto" | "rest" | "walk" | "explore" = "auto", text = "") =>
  parseUserIntent({ minutes: 30, activity, text, avoidCost: false, nearby: false });
function fixture(categories: SearchCategory[][], times = categories.map(() => 4)) {
  const discoveredCandidates: DiscoveredCandidate[] = categories.map((matchedSearchCategories, index) => ({
    poi: { source: "real", provider: "baidu", providerId: `p${index}`, name: `测试地点${index}`, location },
    matchedSearchCategories, discoveryPriority: index ? "low" : "high",
  }));
  const routes: RouteResult[] = discoveredCandidates.map((candidate, index) => ({
    source: "real", provider: "baidu", status: "success", mode: "walking", coordinateSystem: "BD-09",
    from: origin, to: { id: candidate.poi.providerId, location },
    walkingDistanceMeters: times[index] * 60, walkingDurationSeconds: times[index] * 60, walkingMinutes: times[index],
  }));
  return createRealCandidateData({ origin, discoveredCandidates, routes });
}

describe("utility components", () => {
  it("matches browsing/rest/walking/refreshment without treating weak matches as forbidden", () => {
    for (const [input, strong, weak] of [
      [intent("explore"), "bookstore", "park"], [intent("rest"), "cafe", "bookstore"],
      [intent("walk"), "park", "mall"], [intent("auto", "喝点东西"), "dessert", "park"],
    ] as const) {
      expect(preferenceMatch(input,[strong])).toBeGreaterThan(preferenceMatch(input,[weak]));
      expect(preferenceMatch(input,[weak])).toBeGreaterThan(0);
    }
    expect(preferenceMatch(intent("walk"),[])).toBe(0.5);
  });
  it("is flexible by default, ignores duplicated category evidence", () => {
    expect(preferenceMatch(intent(),["park"])).toBe(preferenceMatch(intent(),["cafe"]));
    expect(preferenceMatch(intent("rest"),["cafe","cafe"])).toBe(preferenceMatch(intent("rest"),["cafe"]));
  });
  it("gives diminishing activity benefits and caps them", () => {
    expect(activityBenefit(15)-activityBenefit(5)).toBeGreaterThan(activityBenefit(35)-activityBenefit(25));
    expect(activityBenefit(100)).toBe(activityBenefit(35));
    expect(activityBenefit(0)).toBe(0);
  });
  it("treats longer walking only as a burden", () => {
    expect(mobilityBurden(10,30)).toBeGreaterThan(mobilityBurden(4,30));
    expect(utilityScore({preference:1,activity:0.7,mobility:0.1})).toBeGreaterThan(utilityScore({preference:1,activity:0.7,mobility:0.4}));
  });
});

describe("algorithm v0.2 with discovered candidates", () => {
  it("ranks a browsing match above an equally distant park", () => {
    const results=buildRecommendations(intent("explore"),fixture([["park"],["bookstore"],["mall"]]));
    expect(results[0].places[0].providerId).toBe("p1");
  });
  it("lets preference outweigh a modest extra walk", () => {
    expect(buildRecommendations(intent("walk"),fixture([["cafe"],["park"]],[2,6]))[0].places[0].providerId).toBe("p1");
  });
  it("does not hard-filter non-park candidates under walking intent", () => {
    expect(buildRecommendations(intent("walk"),fixture([["bookstore"]]))).toHaveLength(1);
  });
  it("still prefers lower mobility for the same preference", () => {
    expect(buildRecommendations(intent("rest"),fixture([["cafe"],["cafe"]],[10,3]))[0].places[0].providerId).toBe("p1");
  });
  it("uses category diversity when quality is close", () => {
    const data=fixture([["cafe"],["cafe"],["cafe"],["bookstore"]],[3,4,5,6]);
    const results=buildRecommendations(intent(),data);
    expect(results).toHaveLength(3);
    expect(results.some(p=>p.places[0].providerId==="p3")).toBe(true);
    expect(buildRecommendations(intent(),{...data,places:[...data.places].reverse(),discoveredCandidates:[...data.discoveredCandidates!].reverse()})).toEqual(results);
  });
  it("rejects clearly weak diversity candidates and permits only cafes", () => {
    const result=buildRecommendations(intent("rest"),fixture([["cafe"],["cafe"],["cafe"],["bookstore"]],[3,4,5,21]));
    expect(result).toHaveLength(3);
    expect(result.every(p=>p.places[0].providerId!=="p3")).toBe(true);
    expect(buildRecommendations(intent(),fixture([["cafe"]]))).toHaveLength(1);
    expect(buildRecommendations(intent(),fixture([["cafe"],["cafe"]]))).toHaveLength(2);
  });
  it("removes infeasible and failed routes before scoring", () => {
    const data=fixture([["park"],["bookstore"]],[28,3]);
    expect(buildRecommendations(intent(),data).map(p=>p.places[0].providerId)).toEqual(["p1"]);
    data.routes=[];
    expect(buildRecommendations(intent(),data)).toEqual([]);
  });
  it("does not require returns by default and rejects missing requested returns", () => {
    const input=intent(); const data=fixture([["park"]]);
    expect(input.returnMode).toBe("open_ended");
    expect(buildRecommendations(input,data)).toHaveLength(1);
    expect(buildRecommendations({...input,returnMode:"return_to_start"},data)).toEqual([]);
  });
  it("ignores discovery priority in score and never turns metadata into facts", () => {
    const data=fixture([["park"],["bookstore"]]);
    const before=structuredClone(data);
    const result=buildRecommendations(intent(),data);
    data.discoveredCandidates!.forEach(c=>c.discoveryPriority="medium");
    expect(buildRecommendations(intent(),data)).toEqual(result);
    expect(data.places).toEqual(before.places);
    expect(data.places[0]).not.toHaveProperty("matchedSearchCategories");
    expect(data.places[0].kind).toBeUndefined();
    expect(data.places[0].costRequired).toBeUndefined();
    expect(buildRecommendations({...intent(),avoidCost:true},data)).toEqual([]);
  });
  it("records contributions which reconcile to the selection score", () => {
    const result=buildRecommendations(intent(),fixture([["cafe"],["cafe"],["bookstore"]]));
    for (const plan of result) {
      const trace=plan.scoreTrace!;
      expect(trace.hardConstraints).toBe("passed");
      expect(trace.categorySource).toBe("discovery");
      expect(trace.baseUtility).toBeCloseTo(trace.preferenceContribution+trace.activityContribution+trace.mobilityContribution);
      expect(trace.selectionScore).toBeCloseTo(trace.baseUtility+trace.strategyAdjustment+trace.diversityAdjustment);
      expect(trace.baseUtility).toBeGreaterThanOrEqual(trace.qualityThreshold);
    }
  });
  it("supports legacy POI-only callers with neutral unknown categories", () => {
    const data=fixture([["cafe"]]); delete data.discoveredCandidates;
    expect(buildRecommendations(intent("rest"),data)[0].scoreTrace).toMatchObject({categorySource:"unknown",components:{preference:0.5}});
  });
  it("validates matching identities, coordinates and REAL source", () => {
    const data=fixture([["cafe"]]);
    expect(()=>createRealCandidateData({origin,routes:data.routes,pois:[],discoveredCandidates:data.discoveredCandidates})).toThrow();
    const wrong=structuredClone(data.discoveredCandidates!); wrong[0].poi.source="mock";
    expect(()=>createRealCandidateData({origin,routes:data.routes,discoveredCandidates:wrong})).toThrow();
    const changed=structuredClone(data.discoveredCandidates!); changed[0].poi.location={...location,latitude:31};
    expect(()=>createRealCandidateData({origin,routes:data.routes,pois:data.places,discoveredCandidates:changed})).toThrow();
  });
});

describe("quality first reranking", () => {
  function scored() {
    const data=fixture([["cafe"],["cafe"],["cafe"],["bookstore"]]);
    return data.places.map(place=>{
      const plan=buildRecommendations(intent(),{...data,places:[place]})[0];
      return scorePlan({...plan,categoryCount:1},intent(),data);
    });
  }
  function top(items: ScoredPlan[]) {
    const eligible=qualityGate(items), selected: ScoredPlan[]=[];
    for (const strategy of ["easy","balanced","explore"] as const) {
      const next=selectDiverse(eligible,selected,strategy,intent());
      if(next) selected.push(next.item);
    }
    return selected.map(s=>s.plan.id);
  }
  it("selects book 87 among cafes 90/89/88", () => {
    const items=scored();[90,89,88,87].forEach((n,i)=>items[i].utility=n);
    expect(top(items)).toEqual(["p0","p3","p1"]);
  });
  it("does not select book 40 solely for diversity", () => {
    const items=scored();[90,89,88,40].forEach((n,i)=>items[i].utility=n);
    expect(top(items)).toEqual(["p0","p1","p2"]);
  });
});
