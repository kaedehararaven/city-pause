import { routeMetrics, validRouteMetrics, type RouteEndpoint, type RouteResult, type SuccessfulRouteResult } from "../contracts/map";
import { validLocation } from "./math";

export type EdgeRequest = { from: RouteEndpoint; to: RouteEndpoint; destinationUid?: string };
export type EdgeFetcher = (input: EdgeRequest) => Promise<RouteResult>;
export type EdgeCache = Map<string, { route: SuccessfulRouteResult; expiresAt: number }>;
const endpointKey = (p: RouteEndpoint) => [p.id, p.location.coordinateSystem, p.location.latitude, p.location.longitude];
export const sameEndpoint = (a: RouteEndpoint, b: RouteEndpoint) => JSON.stringify(endpointKey(a)) === JSON.stringify(endpointKey(b));
export const edgeKey = (input: EdgeRequest) => JSON.stringify(["baidu", "walking", "BD-09", "provider-uid-entrance-v1", endpointKey(input.from), endpointKey(input.to), input.destinationUid ?? null]);

export function validEdge(route: RouteResult, input: EdgeRequest, source: "real" | "mock"): route is SuccessfulRouteResult {
  return route.status === "success" && route.source === source && route.provider === (source === "real" ? "baidu" : "mock") && route.mode === "walking" &&
    route.coordinateSystem === "BD-09" && sameEndpoint(route.from, input.from) && sameEndpoint(route.to, input.to) &&
    validLocation(route.from.location) && validLocation(route.to.location) && validRouteMetrics(route) && Number.isFinite(routeMetrics(route).durationSeconds);
}

export class EdgeSession {
  readonly stats = { requests: 0, cacheHits: 0, failures: 0, noRoutes: 0, missingEdges: 0, budgetDenied: 0 };
  private readonly memo = new Map<string, Promise<SuccessfulRouteResult | null>>();
  constructor(private readonly options: {
    source: "real" | "mock"; budget: number; cache: EdgeCache; fetchEdge?: EdgeFetcher;
    signal?: AbortSignal; now?: () => number;
  }) {}
  get budget() { return this.options.budget; }
  peek(input: EdgeRequest): SuccessfulRouteResult | undefined {
    const key = edgeKey(input), cached = this.options.cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= (this.options.now ?? Date.now)() || !validEdge(cached.route, input, this.options.source)) {
      this.options.cache.delete(key); return undefined;
    }
    return cached.route;
  }
  get(input: EdgeRequest): Promise<SuccessfulRouteResult | null> {
    this.options.signal?.throwIfAborted();
    const key = edgeKey(input), previous = this.memo.get(key);
    if (previous) return previous;
    const cached = this.peek(input);
    if (cached) { this.stats.cacheHits++; const value = Promise.resolve(cached); this.memo.set(key, value); return value; }
    if (!this.options.fetchEdge) { this.stats.missingEdges++; const value = Promise.resolve(null); this.memo.set(key, value); return value; }
    if (this.stats.requests >= this.options.budget) { this.stats.budgetDenied++; return Promise.resolve(null); }
    // Reserve before awaiting, so failures and concurrent callers cannot exceed the cap.
    this.stats.requests++;
    const pending = this.fetch(input);
    this.memo.set(key, pending);
    return pending;
  }
  private async fetch(input: EdgeRequest): Promise<SuccessfulRouteResult | null> {
    let route: RouteResult;
    try { route = await this.options.fetchEdge!(input); }
    catch { this.options.signal?.throwIfAborted(); this.stats.failures++; return null; }
    this.options.signal?.throwIfAborted();
    if (route.status === "no_route" && route.source === this.options.source && route.provider === (this.options.source === "real" ? "baidu" : "mock") &&
        route.mode === "walking" && route.coordinateSystem === "BD-09" && sameEndpoint(route.from, input.from) && sameEndpoint(route.to, input.to)) {
      this.stats.noRoutes++; return null;
    }
    if (!validEdge(route, input, this.options.source)) { this.stats.failures++; return null; }
    const cache = this.options.cache;
    for (const [key, entry] of cache) if (entry.expiresAt <= (this.options.now ?? Date.now)()) cache.delete(key);
    while (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(edgeKey(input), { route, expiresAt: (this.options.now ?? Date.now)() + 5 * 60_000 });
    return route;
  }
}
