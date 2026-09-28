import { SEARCH_CATEGORIES } from "../contracts/search";
import type { SearchCategory } from "../contracts/search";

// Provider query choices, not category assertions about returned places.
export const BAIDU_SEARCH_QUERIES = {
  cafe: "咖啡厅",
  dessert: "甜品店",
  bookstore: "书店",
  mall: "购物中心",
  park: "公园",
  culture: "文化艺术",
  lifestyle: "零售生活方式",
} as const satisfies Record<SearchCategory, string>;

export const DISCOVERY_LIMITS = {
  radiusMeters: 1500,
  queryPageSize: 20,
  perCategoryLimit: 4,
  queryTimeoutMs: 10_000,
  queryIntervalMs: 400,
} as const;

export function baiduQueryFor(category: unknown): string | undefined {
  return typeof category === "string" && SEARCH_CATEGORIES.some(item => item === category)
    ? BAIDU_SEARCH_QUERIES[category as keyof typeof BAIDU_SEARCH_QUERIES]
    : undefined;
}
