// A-owned discovery proposal. Product categories are not provider categories or facts.
export const SEARCH_CATEGORIES = ["cafe", "dessert", "bookstore", "mall", "park", "culture", "lifestyle"] as const;
// Legacy category names remain for compatibility with old discovery fixtures.
// Goal-driven v3 uses provider taxonomy paths and S/M layer labels instead.
export type SearchCategory = string;
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
