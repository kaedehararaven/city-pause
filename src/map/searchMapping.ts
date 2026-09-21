import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchCategory, SearchPriority } from "../contracts/search";

// Provider query choices, not category assertions about returned places.
export const BAIDU_SEARCH_QUERIES = {
  bookstore: "书店",
  mall: "购物中心",
  cafe: "咖啡厅",
  dessert: "甜品店",
  park: "公园",
} as const satisfies Record<SearchCategory, string>;

export const DISCOVERY_LIMITS = {
  radiusMeters: 1500,
  queryPageSize: 5,
  poolSize: 10,
  queryTimeoutMs: 10_000,
  queryIntervalMs: 400,
  categorySize: { high: 3, medium: 2, low: 1 },
} as const;
export const PRIORITY_ORDER: Record<SearchPriority, number> = { high: 0, medium: 1, low: 2 };

export function baiduQueryFor(category: unknown): string | undefined {
  return typeof category === "string" && SEARCH_CATEGORIES.some(item => item === category)
    ? BAIDU_SEARCH_QUERIES[category as SearchCategory]
    : undefined;
}
