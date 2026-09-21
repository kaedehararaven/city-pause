import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildSearchPolicy } from "./searchPolicy";
import { parseUserIntent } from "./intent";
import { buildRecommendations } from "./engine";
import { createMockCandidateProvider } from "./mock";
import type { UserInput } from "./intent";

const intent = (overrides: Partial<UserInput> = {}) => parseUserIntent({ minutes: 30, activity: "auto", text: "", avoidCost: false, nearby: false, ...overrides });
const levels = (overrides: Partial<UserInput> = {}) => Object.fromEntries(buildSearchPolicy(intent(overrides)).entries.map(e => [e.category, e.priority]));

describe("Search Policy v0.1", () => {
  it("uses all five product categories for default 30 minutes", () => {
    expect(levels()).toEqual({bookstore:"high", mall:"high", cafe:"high", dessert:"high", park:"medium"});
    expect(levels({text:"30 分钟"})).toEqual(levels());
  });
  it.each(["随便逛逛", "看点东西"])("prioritizes browsing for %s despite the legacy walk classification", text => {
    expect(levels({text})).toEqual({bookstore:"high", mall:"high", cafe:"medium", dessert:"medium", park:"low"});
  });
  it("prioritizes rest without promising seating", () => {
    expect(levels({activity:"rest"})).toEqual({bookstore:"medium", mall:"high", cafe:"high", dessert:"high", park:"low"});
  });
  it.each(["散步", "透气", "户外"])("raises parks for %s but retains other categories", text => {
    expect(levels({text})).toEqual({bookstore:"low", mall:"low", cafe:"low", dessert:"low", park:"high"});
  });
  it.each(["吃点甜的", "喝点东西"])("prioritizes refreshments for %s", text => {
    expect(levels({text})).toEqual({bookstore:"low", mall:"high", cafe:"high", dessert:"high", park:"low"});
  });
  it("honors structured activity before text and resolves mixed text deterministically", () => {
    expect(levels({activity:"walk",text:"喝点东西"}).park).toBe("high");
    expect(levels({text:"散步，喝点东西"}).dessert).toBe("high");
  });
  it("does not interpret negative clauses as positive preferences", () => {
    expect(levels({text:"不想喝点东西"})).toEqual(levels());
    expect(levels({text:"不想喝咖啡，但想散步"}).park).toBe("high");
  });
  it("removes explicit category exclusions, without broadening library or garden exclusions", () => {
    const input = intent(); input.excludedKinds = ["book", "cafe", "lib", "garden"];
    expect(buildSearchPolicy(input).entries.map(e=>e.category)).toEqual(["mall","dessert","park"]);
    input.excludedKinds = ["bookstore","mall","cafe","dessert","park"];
    expect(buildSearchPolicy(input).entries).toEqual([]);
  });
  it("uses small time bands only for default preferences", () => {
    expect(levels({minutes:15})).toMatchObject({mall:"medium",park:"low"});
    expect(levels({minutes:30}).park).toBe("medium");
    expect(levels({minutes:60}).park).toBe("high");
    expect(levels({minutes:60,activity:"rest"}).park).toBe("low");
  });
  it("outputs only the discovery contract, no POIs or inferred map facts", () => {
    const result=buildSearchPolicy(intent({avoidCost:true}));
    expect(Object.keys(result).sort()).toEqual(["availableMinutes","entries","version"]);
    for (const entry of result.entries) {
      expect(Object.keys(entry).sort()).toEqual(["category","priority","reason"]);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
    expect(levels({avoidCost:true})).toEqual(levels());
  });
  it("has no runtime map/provider/network dependencies", () => {
    const source=readFileSync(new URL('./searchPolicy.ts',import.meta.url),'utf8');
    const imports=[...source.matchAll(/from "([^"]+)"/g)].map(m=>m[1]);
    expect(imports).toEqual(["../contracts/search","../contracts/search","./model"]);
    expect(source).not.toMatch(/fetch\(|axios|BMap|Math\.random/);
    expect(readFileSync(new URL('../contracts/search.ts',import.meta.url),'utf8')).not.toMatch(/\bimport\b/);
  });
  it("does not mutate intent, recommendation results, or default open-ended semantics", () => {
    const input=intent(); const before=structuredClone(input);
    const data=createMockCandidateProvider().getCandidateData();
    const plans=buildRecommendations(input,data);
    expect(buildSearchPolicy(input)).toEqual(buildSearchPolicy(input));
    expect(input).toEqual(before);
    expect(input.returnMode).toBe("open_ended");
    expect(buildRecommendations(input,data)).toEqual(plans);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every(p=>p.steps.every(s=>s.kind!=="返程"))).toBe(true);
  });
  it("does not let high search priority override route feasibility", () => {
    const input=intent();
    const data=createMockCandidateProvider().getCandidateData();
    data.places=data.places.filter(p=>p.kind==="book");
    data.routes=data.routes.map(r=>r.status==="success" ? {...r,walkingMinutes:25,walkingDurationSeconds:1500} : r);
    expect(levels().bookstore).toBe("high");
    expect(buildRecommendations(input,data)).toEqual([]);
  });
  it.each([0,NaN,30.5,181])("rejects invalid budget %s", minutes => {
    expect(()=>buildSearchPolicy(intent({minutes}))).toThrow(RangeError);
  });
});
