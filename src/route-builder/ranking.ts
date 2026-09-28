import type { MultiRoute } from "./model";

export const goalOrder = { S: 2, M: 1, W: 0 } as const;
function goalCompare(a: MultiRoute, b: MultiRoute) {
  return goalOrder[b.weakestGoal] - goalOrder[a.weakestGoal] || b.strongProportion - a.strongProportion;
}
const knownDescending = (a: number | null, b: number | null) => a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a;
function secondary(a: MultiRoute, b: MultiRoute) {
  const geometric = knownDescending(a.geometry, b.geometry);
  if (geometric) return geometric;
  if (!(a.minRating !== null && b.minRating !== null && a.minRating > 4.5 && b.minRating > 4.5)) {
    const rating = knownDescending(a.minRating, b.minRating);
    if (rating) return rating;
  }
  const price = a.meanMerchantPrice === null ? (b.meanMerchantPrice === null ? 0 : 1)
    : b.meanMerchantPrice === null ? -1 : a.meanMerchantPrice - b.meanMerchantPrice;
  return price || a.id.localeCompare(b.id);
}

export function rankRoutes(routes: readonly MultiRoute[]): MultiRoute[] {
  const pending = [...routes].sort((a, b) => goalCompare(a, b) || a.travelSeconds - b.travelSeconds || a.id.localeCompare(b.id));
  const result: MultiRoute[] = [];
  // Fixed-reference mobility bands avoid a non-transitive pairwise comparator.
  for (let start = 0; start < pending.length;) {
    const reference = pending[start];
    let end = start + 1;
    while (end < pending.length && goalCompare(reference, pending[end]) === 0 &&
      (reference.travelSeconds === 0 ? pending[end].travelSeconds === 0 : pending[end].travelSeconds < reference.travelSeconds * 1.2)) end++;
    result.push(...pending.slice(start, end).sort(secondary)); start = end;
  }
  return result;
}
const subset = (a: Set<string>, b: Set<string>) => [...a].every(key => b.has(key));
export function distinctRoutes(ordered: readonly MultiRoute[]): MultiRoute[] {
  const kept: MultiRoute[] = [];
  for (const route of ordered) {
    const ids = new Set(route.stops.map(stop => `${stop.poi.provider}:${stop.poi.providerId}`));
    const families = new Set(route.stops.slice(1).map(stop => stop.family));
    if (kept.some(other => {
      const otherIds = new Set(other.stops.map(stop => `${stop.poi.provider}:${stop.poi.providerId}`));
      const otherFamilies = new Set(other.stops.slice(1).map(stop => stop.family));
      return subset(ids, otherIds) || subset(otherIds, ids) || subset(families, otherFamilies) || subset(otherFamilies, families);
    })) continue;
    kept.push(route);
    if (kept.length === 3) break;
  }
  return kept;
}
