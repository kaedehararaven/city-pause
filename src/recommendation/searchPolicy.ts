import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchCategory, SearchPolicy, SearchPriority } from "../contracts/search";
import type { UserIntent } from "./model";

type Profile = "default" | "browsing" | "rest" | "walking" | "refreshment";
const rules: Record<Profile, { priorities: readonly SearchPriority[]; reason: string }> = {
  default: { priorities: ["high", "high", "high", "high", "medium"], reason: "无明确活动偏好，保留多样搜索方向" },
  browsing: { priorities: ["high", "high", "medium", "medium", "low"], reason: "匹配看点东西、随便逛逛的搜索偏好" },
  rest: { priorities: ["medium", "high", "high", "high", "low"], reason: "匹配歇一会儿的搜索偏好，不保证座位或安静" },
  walking: { priorities: ["low", "low", "low", "low", "high"], reason: "匹配散步、透气的搜索偏好，其他类别仍保留" },
  refreshment: { priorities: ["low", "high", "high", "high", "low"], reason: "匹配饮品、甜点的搜索偏好，不推断价格" },
};
const activityProfile = { rest: "rest", walk: "walking", explore: "browsing" } as const;

function profileFor(intent: UserIntent): Profile {
  // Explicit structured choices retain the precedence used by the current Planner.
  if (intent.source.activity === "button" || intent.source.activity === "form") {
    return activityProfile[intent.activity];
  }
  // Small, documented lexical fallback only. Ignore negated clauses rather than
  // interpreting "不想喝咖啡" as a positive refreshment preference.
  const positive = intent.rawText.split(/[，。；,;！？!?\n]|但是|但|不过/)
    .filter(clause => !/不想|不要|不去|不喝|不吃|不喜欢|不用|不必|无需|别|排除/.test(clause)).join("，");
  if (/甜品|甜点|吃点甜|喝点|饮品|咖啡|烘焙/.test(positive)) return "refreshment";
  if (/歇|休息|坐一下|想坐|走累|累了/.test(positive)) return "rest";
  if (/散步|透气|户外|走走/.test(positive)) return "walking";
  if (/随便逛|逛逛|看点东西|书店|商场/.test(positive)) return "browsing";
  // The parser's default "explore" is not an explicit browsing request.
  if (intent.source.activity === "text-rule") return activityProfile[intent.activity];
  return "default";
}

export function buildSearchPolicy(intent: UserIntent): SearchPolicy {
  if (!Number.isInteger(intent.availableMinutes) || intent.availableMinutes < 5 || intent.availableMinutes > 180) {
    throw new RangeError("Search policy requires an integer budget of 5–180 minutes");
  }
  const profile = profileFor(intent);
  const rule = rules[profile];
  // Only canonical product exclusions and the existing A-side "book" alias.
  // "garden" and "lib" do not prove exclusion of the entire park/bookstore category.
  const excluded = new Set(intent.excludedKinds.map(kind => kind === "book" ? "bookstore" : kind));
  const priorities = Object.fromEntries(SEARCH_CATEGORIES.map((category, i) => [category, rule.priorities[i]])) as Record<SearchCategory, SearchPriority>;
  let timeReason = "";
  if (profile === "default" && intent.availableMinutes <= 15) {
    priorities.mall = "medium";
    priorities.park = "low";
    timeReason = "；短空档先搜书店、饮品与甜点，距离仍待路线验证";
  } else if (profile === "default" && intent.availableMinutes >= 45) {
    priorities.park = "high";
    timeReason = "；较长空档提高公园发现优先级";
  }
  return {
    version: "0.1",
    availableMinutes: intent.availableMinutes,
    // Stable enumeration order is not a ranking within a priority level.
    entries: SEARCH_CATEGORIES.filter(category => !excluded.has(category)).map(category => ({
      category, priority: priorities[category], reason: rule.reason + timeReason,
    })),
  };
}
