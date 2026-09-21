// A-owned discovery proposal. Product categories are not provider categories or facts.
export const SEARCH_CATEGORIES = ["bookstore", "mall", "cafe", "dessert", "park"] as const;
export type SearchCategory = typeof SEARCH_CATEGORIES[number];
export type SearchPriority = "high" | "medium" | "low";
export type SearchPolicyEntry = {
  category: SearchCategory;
  priority: SearchPriority;
  reason: string;
};
export type SearchPolicy = {
  version: "0.1";
  availableMinutes: number;
  entries: SearchPolicyEntry[];
};
