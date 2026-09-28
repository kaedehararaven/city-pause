import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchPolicy } from "../contracts/search";
import type { UserIntent } from "./model";

// Candidate supply is independent of activity and goal. The legacy priority
// field remains only for the discovery wire shape and has no decision role.
export function profileFor(_intent: UserIntent): "default" { return "default"; }

export function buildSearchPolicy(intent: UserIntent): SearchPolicy {
  if (!Number.isInteger(intent.availableMinutes) || intent.availableMinutes < 5 || intent.availableMinutes > 180) {
    throw new RangeError("Search policy requires an integer budget of 5–180 minutes");
  }
  const excluded = new Set(intent.excludedKinds.map(kind => kind === "book" ? "bookstore" : kind));
  return {
    version: "0.1",
    availableMinutes: intent.availableMinutes,
    entries: SEARCH_CATEGORIES.filter(category => !excluded.has(category)).map(category => ({
      category, priority: "medium", reason: "基础候选供给：各大类平等搜索，推荐阶段再比较因素",
    })),
  };
}
