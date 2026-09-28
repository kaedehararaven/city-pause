import { routeMetrics, type SuccessfulRouteResult } from "../contracts/map";
import { passesTravelGate } from "../contracts/mobility";
import { bufferForBudget } from "../recommendation/engine";
import { merchantPrice } from "../recommendation/factors";
import type { CandidateData, Recommendation, UserIntent } from "../recommendation/model";
import { EdgeSession, validEdge, type EdgeCache, type EdgeFetcher } from "./edges";
import { allocateDwell, geometry, validLocation } from "./math";
import type { BuildResult, BuildStatus, MultiRoute, RouteCandidate } from "./model";
import { DEFAULT_ROUTE_BUDGET, familyFor, multiStopDwellRange, maxStops, MAX_PREFIXES, MAX_SECOND_PROPOSALS, MAX_THIRD_PROPOSALS } from "./policy";
import { goalOrder, rankRoutes } from "./ranking";

export type BuildInput = {
  intent: UserIntent; data: CandidateData; singles: readonly Recommendation[];
  cache?: EdgeCache; fetchEdge?: EdgeFetcher; signal?: AbortSignal; budget?: 6 | 12;
  session?: EdgeSession;
};

export async function buildMultiStop(input: BuildInput): Promise<BuildResult> {
  const { intent, data, signal } = input;
  signal?.throwIfAborted();
  const budget = input.session?.budget ?? input.budget ?? DEFAULT_ROUTE_BUDGET;
  const session = input.session ?? new EdgeSession({ source: data.source, budget, cache: input.cache ?? new Map(), fetchEdge: input.fetchEdge, signal });
  const limit = maxStops(intent);
  const audit: BuildResult["audit"] = { budget, ...session.stats, truncated: 0, anchorAttempts: [], candidates: 0, skippedCandidates: 0, verifiedPairs: 0, verifiedTriples: 0,
    maxStops: limit, unusedRequestBudget: budget, familyCounts: {}, skippedReasons: {}, precheckRejections: {}, routeRejections: {},
    secondProposalsChecked: 0, thirdProposalsChecked: 0, reallocatedSecondRequests: 0, removedPairs: 0, removedTriples: 0 };
  const finish = (status: BuildStatus, routes: MultiRoute[] = []): BuildResult => ({ status, routes, audit: { ...audit, ...session.stats, unusedRequestBudget: budget - session.stats.requests } });
  const count = (counts: Record<string, number>, reason: string) => { counts[reason] = (counts[reason] ?? 0) + 1; };
  if (!limit) return finish("not_applicable");
  if (intent.returnMode !== "open_ended" || (data.travelMode ?? "walking") !== "walking") return finish("unsupported_mode");
  const seen = new Set<string>();
  const candidates: RouteCandidate[] = [];
  for (const [rank, single] of input.singles.entries()) {
    const poi = single.places[0];
    if (!poi || single.places.length !== 1 || !single.goalMatch || poi.source !== data.source || !validLocation(poi.location)) { count(audit.skippedReasons, "invalid_or_unclassified_single"); continue; }
    const key = `${poi.provider}:${poi.providerId}`, family = familyFor(poi);
    const endpoint = { id: poi.providerId, location: poi.location };
    const outbound = single.routes.find(route => validEdge(route, { from: data.origin, to: endpoint }, data.source));
    if (!family || seen.has(key) || !outbound) { count(audit.skippedReasons, !family ? "family_unknown" : seen.has(key) ? "duplicate_poi" : "outbound_invalid"); continue; }
    seen.add(key);
    candidates.push({ poi, endpoint, rank, goalMatch: single.goalMatch, family: family.family, familyLabel: family.label, range: multiStopDwellRange(family, intent.activity), outbound });
    audit.familyCounts[family.family] = (audit.familyCounts[family.family] ?? 0) + 1;
  }
  audit.candidates = candidates.length;
  audit.skippedCandidates = input.singles.length - candidates.length;
  if (candidates.length < 2) return finish(audit.skippedCandidates ? "missing_candidate_facts" : "no_feasible_multi_stop");

  const buffer = bufferForBudget(intent.availableMinutes);
  const feasible = (stops: RouteCandidate[], seconds: number, reasons: Record<string, number>) => {
    const reason = new Set(stops.map(stop => stop.poi.providerId)).size !== stops.length ? "duplicate_poi"
      : new Set(stops.map(stop => stop.family)).size !== stops.length ? "same_family"
      : !passesTravelGate({ ...intent, returnMode: "open_ended" }, seconds) ? "travel_gate"
      : intent.maxWalkingMinutes && seconds > intent.maxWalkingMinutes.value * 60 ? "walking_must"
      : seconds / 60 + buffer + stops.reduce((sum, stop) => sum + stop.range.min, 0) > intent.availableMinutes ? "minimum_dwell_budget" : null;
    if (reason) count(reasons, reason);
    return reason === null;
  };
  const request = (a: RouteCandidate, b: RouteCandidate) => ({ from: a.endpoint, to: b.endpoint, destinationUid: b.poi.providerId });
  const locations = (stops: RouteCandidate[]) => [data.origin.location, ...stops.map(stop => stop.endpoint.location)];
  const secondsOf = (edges: SuccessfulRouteResult[]) => edges.reduce((sum, edge) => sum + routeMetrics(edge).durationSeconds, 0);

  const propose = (prefix: RouteCandidate[], pool: RouteCandidate[]) => [...pool].sort((a, b) => {
    const aStops = [...prefix, a], bStops = [...prefix, b];
    const weakest = (stops: RouteCandidate[]) => Math.min(...stops.map(stop => goalOrder[stop.goalMatch]));
    return weakest(bStops) - weakest(aStops) ||
      (geometry(locations(bStops)).ratio ?? -1) - (geometry(locations(aStops)).ratio ?? -1) || a.rank - b.rank;
  });
  const makeRoute = (stops: RouteCandidate[], edges: SuccessfulRouteResult[], prefix?: MultiRoute): MultiRoute | null => {
    const travelSeconds = secondsOf(edges);
    if (!feasible(stops, travelSeconds, audit.routeRejections)) return null;
    const availableDwell = intent.availableMinutes - buffer - travelSeconds / 60;
    const extra = prefix ? allocateDwell([stops[2].range], availableDwell - prefix.exactDwell.reduce((sum, value) => sum + value, 0)) : null;
    const dwell = prefix ? (extra ? { exact: [...prefix.exactDwell, ...extra.exact], display: [...prefix.displayDwell, ...extra.display] } : null)
      : allocateDwell(stops.map(stop => stop.range), availableDwell);
    if (!dwell) return null;
    const ratings = stops.map(stop => stop.poi.rating), prices = stops.map(stop => merchantPrice(stop.poi.priceText));
    const totalMinutes = travelSeconds / 60 + buffer + dwell.display.reduce((sum, value) => sum + value, 0);
    const exactTotalMinutes = travelSeconds / 60 + buffer + dwell.exact.reduce((sum, value) => sum + value, 0);
    return {
      id: `multi:${stops.map(stop => `${stop.poi.provider}:${stop.poi.providerId}`).join("|")}`,
      title: stops.map(stop => stop.poi.name).join(" → "), source: data.source, originName: data.origin.name,
      stops, edges, travelSeconds, exactDwell: dwell.exact, displayDwell: dwell.display, bufferMinutes: buffer,
      exactTotalMinutes, totalMinutes,
      unusedAfterDwellMaxMinutes: Math.max(0, intent.availableMinutes - exactTotalMinutes),
      displayRoundingMinutes: Math.max(0, exactTotalMinutes - totalMinutes),
      remainingMinutes: Math.max(0, intent.availableMinutes - totalMinutes), geometry: geometry(locations(stops)).ratio,
      weakestGoal: [...stops].sort((a, b) => goalOrder[a.goalMatch] - goalOrder[b.goalMatch])[0].goalMatch,
      strongProportion: stops.filter(stop => stop.goalMatch === "S").length / stops.length,
      minRating: ratings.every((rating): rating is number => rating !== undefined && Number.isFinite(rating) && rating >= 0 && rating <= 5) ? Math.min(...ratings) : null,
      meanMerchantPrice: prices.every((price): price is number => price !== null) ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null,
      steps: [...stops.flatMap((stop, index) => [
        { kind: "步行" as const, label: `${index === 0 ? data.origin.name : stops[index - 1].poi.name} → ${stop.poi.name}`, minutes: routeMetrics(edges[index]).durationSeconds / 60 },
        { kind: "停留" as const, label: `${stop.poi.name} · 约 ${dwell.display[index]} 分钟`, minutes: dwell.display[index] },
      ]), { kind: "缓冲", label: "安全缓冲", minutes: buffer }],
    };
  };

  const anchors = candidates.slice(0, 3);
  const selected: MultiRoute[] = [];
  const samePlaces = (a: readonly RouteCandidate[], b: readonly RouteCandidate[]) => a.length === b.length &&
    a.every(stop => b.some(other => other.poi.provider === stop.poi.provider && other.poi.providerId === stop.poi.providerId));
  let hadPotential = false;
  for (const [anchorIndex, fixedAnchor] of anchors.entries()) {
    signal?.throwIfAborted();
    // Full-pool optimistic precheck, then bounded independent construction. Missing edges
    // are not proof of impossibility and each anchor retains its default rank.
    const partners = candidates.filter(other => {
      const known = session.peek(request(fixedAnchor, other));
      return feasible([fixedAnchor, other], routeMetrics(fixedAnchor.outbound).durationSeconds + (known ? routeMetrics(known).durationSeconds : 0), audit.precheckRejections);
    });
    const attempt = { rank: fixedAnchor.rank, potentialPartners: partners.length, scanned: candidates.length, requests: 0, outcome: "free_infeasible" };
    audit.anchorAttempts.push(attempt);
    if (!partners.length) continue;
    hadPotential = true;
    const requestsBeforeAnchor = session.stats.requests;
    // Each anchor keeps a bounded share even after success; later anchors
    // independently contribute one alternative without resetting the ledger.
    const probeLimit = requestsBeforeAnchor + Math.max(1, Math.floor((budget - requestsBeforeAnchor) / (anchors.length - anchorIndex)));
    const secondCap = limit === 3 ? Math.min(MAX_SECOND_PROPOSALS, Math.max(1, Math.floor((probeLimit - requestsBeforeAnchor) / 2))) : MAX_SECOND_PROPOSALS;
    const proposals = propose([fixedAnchor], partners);
    audit.truncated += Math.max(0, proposals.length - MAX_SECOND_PROPOSALS);
    const pairs: MultiRoute[] = [];
    const drafts: MultiRoute[] = [];
    const verifyPair = async (partner: RouteCandidate) => {
      signal?.throwIfAborted();
      if (limit === 2 && selected.some(route => samePlaces(route.stops, [fixedAnchor, partner]))) return;
      if (session.stats.requests >= probeLimit && !session.peek(request(fixedAnchor, partner))) { audit.truncated++; return; }
      audit.secondProposalsChecked++;
      const edge = await session.get(request(fixedAnchor, partner));
      if (!edge) return;
      const route = makeRoute([fixedAnchor, partner], [fixedAnchor.outbound, edge]);
      if (route) { pairs.push(route); drafts.push(route); }
    };
    const expandedPrefixes = new Set<string>();
    const expandPairs = async () => {
      if (limit !== 3) return;
      const prefixes = rankRoutes(pairs).filter(pair => !expandedPrefixes.has(pair.id));
      for (const pair of prefixes.slice(0, Math.max(0, MAX_PREFIXES - expandedPrefixes.size))) {
        expandedPrefixes.add(pair.id);
        const tail = pair.stops.at(-1)!;
        const thirds = propose(pair.stops, candidates.filter(stop => {
          const known = session.peek(request(tail, stop));
          if (goalOrder[stop.goalMatch] < goalOrder[pair.weakestGoal]) { count(audit.precheckRejections, "extension_goal_downgrade"); return false; }
          if (pair.exactTotalMinutes + stop.range.min + (known ? routeMetrics(known).durationSeconds / 60 : 0) > intent.availableMinutes) {
            count(audit.precheckRejections, "extension_dwell_protection"); return false;
          }
          return feasible([...pair.stops, stop], pair.travelSeconds + (known ? routeMetrics(known).durationSeconds : 0), audit.precheckRejections);
        }));
        audit.truncated += Math.max(0, thirds.length - MAX_THIRD_PROPOSALS);
        for (const third of thirds.slice(0, MAX_THIRD_PROPOSALS)) {
          signal?.throwIfAborted();
          // At 90 minutes the displayed choice stays a pair. Only inspect cached
          // extensions there; reserve paid validation for long-window expansion.
          if (intent.availableMinutes < 120 && !session.peek(request(tail, third))) continue;
          if (session.stats.requests >= probeLimit && !session.peek(request(tail, third))) { audit.truncated++; continue; }
          audit.thirdProposalsChecked++;
          const edge = await session.get(request(tail, third));
          if (!edge) continue;
          const route = makeRoute([...pair.stops, third], [...pair.edges, edge], pair);
          if (!route) count(audit.routeRejections, "extension_unavailable");
          if (route) { drafts.push(route); audit.verifiedTriples++; }
        }
      }
    };
    for (const partner of proposals.slice(0, secondCap)) await verifyPair(partner);
    await expandPairs();
    for (const partner of proposals.slice(secondCap, MAX_SECOND_PROPOSALS)) {
      const before = session.stats.requests;
      await verifyPair(partner);
      audit.reallocatedSecondRequests += session.stats.requests - before;
      await expandPairs();
    }
    audit.verifiedPairs += pairs.length;
    if (limit === 3) audit.truncated += pairs.length - expandedPrefixes.size;
    const available = (route: MultiRoute) => !selected.some(other => samePlaces(route.stops, other.stops));
    const pair = rankRoutes(pairs).find(available);
    // Preserve the best pair's ordered prefix, rather than replacing it with a
    // different pair merely to obtain three stops. Selection precedes dedup.
    const extension = pair && intent.availableMinutes >= 120 ? rankRoutes(drafts.filter(route => route.stops.length === 3 &&
      pair.stops.every((stop, index) => stop.poi.providerId === route.stops[index].poi.providerId) &&
      goalOrder[route.weakestGoal] >= goalOrder[pair.weakestGoal] && available(route)))[0] : undefined;
    const routes = extension ? [extension] : pair ? [pair] : [];
    attempt.requests = session.stats.requests - requestsBeforeAnchor;
    attempt.outcome = routes.length ? "success" : "validation_exhausted";
    if (routes.length) {
      selected.push(routes[0]);
    }
  }
  audit.removedPairs = audit.verifiedPairs - selected.filter(route => route.stops.length === 2).length;
  audit.removedTriples = audit.verifiedTriples - selected.filter(route => route.stops.length === 3).length;
  if (selected.length) return finish("ok", selected);
  if (!hadPotential) return finish("no_feasible_multi_stop");
  return finish(session.stats.missingEdges ? "missing_offline_edges" : session.stats.failures ? "provider_unavailable"
    : audit.truncated || session.stats.budgetDenied ? "search_incomplete" : "no_route_for_anchor");
}
