import type { CandidatePlace, UserIntent } from "../recommendation/model";

export type Family = "food" | "bookCafe" | "catCafe" | "green" | "culture" | "commercial" | "mall" | "interest" | "daily" | "experience" | "heritage";
export type DwellRange = { min: number; max: number };
const families: { family: Family; label: string; range: DwellRange; paths: string[] }[] = [
  { family: "food", label: "休憩饮食", range: { min: 30, max: 60 }, paths: ["美食>咖啡厅", "休闲娱乐>茶馆", "美食>甜品店", "美食>饮品店", "美食>糕点烘焙"] },
  { family: "bookCafe", label: "书咖", range: { min: 30, max: 60 }, paths: ["休闲娱乐>书咖"] },
  { family: "catCafe", label: "猫咖", range: { min: 60, max: 120 }, paths: ["休闲娱乐>猫咖"] },
  { family: "green", label: "绿色漫游", range: { min: 30, max: 60 }, paths: ["旅游景点>公园", "旅游景点>植物园"] },
  { family: "culture", label: "文化观展", range: { min: 40, max: 90 }, paths: ["旅游景点>美术馆", "旅游景点>博物馆", "文化传媒>艺术馆", "文化传媒>展览馆"] },
  { family: "commercial", label: "商业漫游", range: { min: 25, max: 50 }, paths: ["购物>商业街", "休闲娱乐>休闲广场"] },
  { family: "mall", label: "购物中心", range: { min: 40, max: 90 }, paths: ["购物>购物中心"] },
  { family: "interest", label: "兴趣零售", range: { min: 15, max: 40 }, paths: ["购物>商铺>书店", "购物>商铺>动漫店"] },
  { family: "daily", label: "日常零售", range: { min: 15, max: 40 }, paths: ["购物>商铺>副食品店>零食店", "购物>超市", "购物>便利店"] },
  { family: "experience", label: "体验探索", range: { min: 40, max: 90 }, paths: ["休闲娱乐>游乐游艺>新奇体验馆", "休闲娱乐>手工制作"] },
  { family: "heritage", label: "人文漫游", range: { min: 50, max: 90 }, paths: ["旅游景点>人文景观>古村古镇"] },
];

// Only confirmed classified_poi_tag ancestors; never title/category/brand inference.
export function familyFor(poi: Pick<CandidatePlace, "classifiedPoiTag">) {
  const tag = poi.classifiedPoiTag?.replace(/[;；/／,，]/g, ">").replace(/\s+/g, "");
  return families.flatMap(item => item.paths.map(path => ({ ...item, path })))
    .filter(item => tag === item.path || tag?.startsWith(`${item.path}>`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export function multiStopDwellRange(family: NonNullable<ReturnType<typeof familyFor>>, activity: UserIntent["activity"]): DwellRange {
  const extendedRest = activity === "rest" && ["美食>咖啡厅", "休闲娱乐>书咖", "休闲娱乐>茶馆"].includes(family.path);
  return { ...family.range, ...(extendedRest ? { max: 120 } : {}) };
}

export function maxStops(intent: UserIntent): 0 | 2 | 3 {
  if (intent.availableMinutes < 45) return 0;
  return intent.availableMinutes < 90 || intent.activity === "rest" ? 2 : 3;
}

// Experimental exploration caps, not quality weights. Six is the conservative
// deployment setting; both six and twelve still require real-world calibration.
export const DEFAULT_ROUTE_BUDGET = 6;
export const MAX_SECOND_PROPOSALS = 6;
export const MAX_PREFIXES = 3;
export const MAX_THIRD_PROPOSALS = 2;
