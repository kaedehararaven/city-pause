import { describe, expect, it } from "vitest";
import { parseUserIntent } from "./intent";
import { buildSearchPolicy } from "./searchPolicy";
const input = (text = "") => parseUserIntent({ minutes: 30, activity: "auto", text, avoidCost: false, nearby: false });
describe("basic candidate supply policy", () => {
  it("searches seven neutral categories", () => {
    const entries = buildSearchPolicy(input()).entries;
    expect(entries.map(entry => entry.category)).toEqual(["cafe", "dessert", "bookstore", "mall", "park", "culture", "lifestyle"]);
    expect(new Set(entries.map(entry => entry.priority))).toEqual(new Set(["medium"]));
  });
  it("does not change supply based on activity", () => expect(buildSearchPolicy(input("散步")).entries.map(e => e.category)).toEqual(buildSearchPolicy(input("歇一会儿")).entries.map(e => e.category)));
  it("keeps explicit exclusions", () => expect(buildSearchPolicy(input("不想去书店")).entries.map(e => e.category)).not.toContain("bookstore"));
});
