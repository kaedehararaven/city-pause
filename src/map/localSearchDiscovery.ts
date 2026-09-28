import type { MapLocation } from "../contracts/map";
import { adaptBaiduLocalResultPoi } from "./poiAdapter";
import type { DiscoverySearch, DiscoveryQueryResult } from "./discovery";
import { validDiscoveryCenter } from "./discovery";
import { BAIDU_SEARCH_QUERIES, DISCOVERY_LIMITS } from "./searchMapping";

function createSearch(api: typeof BMap, center: MapLocation, radiusMeters: number, allowComposite: boolean): DiscoverySearch {
  let lastStarted = -Infinity;
  return async (query, signal) => {
    signal.throwIfAborted();
    const delay = Math.max(0, lastStarted + DISCOVERY_LIMITS.queryIntervalMs - Date.now());
    if (delay > 0) await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Discovery cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, delay);
      signal.addEventListener("abort", abort, { once: true });
    });
    signal.throwIfAborted();
    lastStarted = Date.now();
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      if (!validDiscoveryCenter(center) || !Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 12000 || (!allowComposite && !Object.values(BAIDU_SEARCH_QUERIES).some(value => value === query))) {
        resolve({ status: "provider_error" });
        return;
      }
      let search: BMap.LocalSearch | undefined;
      let settled = false;
      const finish = (result?: DiscoveryQueryResult, clearResults = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        // Baidu continues processing the result after onSearchComplete returns.
        // Clearing it inside that callback invalidates SDK internal state.
        if (!result || clearResults) search?.clearResults();
        if (result) resolve(result);
        else reject(new DOMException("Discovery cancelled", "AbortError"));
      };
      const abort = () => finish();
      const timer = setTimeout(() => finish({ status: "timeout" }, true), DISCOVERY_LIMITS.queryTimeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      try {
        const point = new api.Point(center.longitude, center.latitude);
        search = new api.LocalSearch(point, {
          pageCapacity: DISCOVERY_LIMITS.queryPageSize,
          onSearchComplete(results) {
            if (settled) return;
            try {
              const status = search!.getStatus();
              const resultSets = Array.isArray(results) ? results : [results];
              if (status === 8) { finish({ status: "timeout" }); return; }
              // UNKNOWN_LOCATION alone does not prove an empty query. Require explicit zero counts.
              if ((status === 0 || status === 2) && resultSets.every(result => result.getNumPois() === 0 && result.getCurrentNumPois() === 0)) {
                finish({ status: "empty", pois: [], totalReported: 0, inspectedCount: 0, rawResultCount: 0, rawResultSetCount: resultSets.length, adapterInputCount: 0 });
                return;
              }
              if (status !== 0 || !resultSets.length) { finish({ status: "provider_error" }); return; }
              const counts = resultSets.map(result => ({ count: result.getCurrentNumPois(), total: result.getNumPois() }));
              if (counts.some(({ count, total }) => !Number.isInteger(count) || count < 0 || !Number.isInteger(total) || total < count)) {
                finish({ status: "provider_error" }); return;
              }
              const adapterInputs = resultSets.flatMap((result, resultIndex) => Array.from({ length: counts[resultIndex].count }, (_, index) => result.getPoi(index)));
              const pois = adapterInputs.flatMap(poi => { const adapted = poi && adaptBaiduLocalResultPoi(poi); return adapted ? [adapted] : []; });
              finish({ status: "success", pois, totalReported: counts.reduce((sum, item) => sum + item.total, 0), inspectedCount: adapterInputs.length, rawResultCount: adapterInputs.length, rawResultSetCount: resultSets.length, adapterInputCount: adapterInputs.length });
            } catch {
              finish({ status: "provider_error" });
            }
          },
        });
        search.searchNearby(query, point, radiusMeters);
      } catch {
        finish({ status: "provider_error" });
      }
    });
  };
}

export function createBaiduDiscoverySearch(api: typeof BMap, center: MapLocation, radiusMeters: number = DISCOVERY_LIMITS.radiusMeters): DiscoverySearch {
  return createSearch(api, center, radiusMeters, false);
}

// Goal Supply v3 deliberately performs one LocalSearch action for a whole S or M layer.
export function createCompositeBaiduDiscoverySearch(api: typeof BMap, center: MapLocation, radiusMeters: number = DISCOVERY_LIMITS.radiusMeters): DiscoverySearch {
  return createSearch(api, center, radiusMeters, true);
}
