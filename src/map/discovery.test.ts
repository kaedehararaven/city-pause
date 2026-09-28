import { describe, expect, it } from "vitest";
import { discoverCandidates } from "./discovery";
import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchPolicy } from "../contracts/search";
const policy: SearchPolicy = { version: "0.1", availableMinutes: 30, entries: SEARCH_CATEGORIES.map(category => ({ category, priority: "medium", reason: "fixture" })) };
const center = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const };
const poi = (category: string, index: number) => ({ source: "real" as const, provider: "baidu" as const, providerId: `${category}-${index}`, name: `${category}${index}`, location: center });
describe("basic candidate discovery", () => {
  it("searches all seven categories and retains at most four per category", async () => {
    const result = await discoverCandidates({ center, policy }, async query => ({ status: "success" as const, totalReported: 8, inspectedCount: 8, pois: [0, 1, 2, 3, 4].map(i => poi(Array.isArray(query) ? query.join("+") : query, i)) }));
    expect(result.categories).toHaveLength(7);
    expect(result.candidates).toHaveLength(28);
    expect(result.categories.every(category => category.retainedCount <= 4)).toBe(true);
  });
  it("deduplicates by provider identity and keeps category provenance", async () => {
    const shared = poi("shared", 0);
    const result = await discoverCandidates({ center, policy: { ...policy, entries: policy.entries.slice(0, 2) } }, async () => ({ status: "success", totalReported: 1, inspectedCount: 1, pois: [shared] }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].matchedSearchCategories).toHaveLength(2);
  });
});
