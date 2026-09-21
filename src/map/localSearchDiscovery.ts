import type { MapLocation } from "../contracts/map";
import { adaptBaiduLocalResultPoi } from "./poiAdapter";
import type { DiscoverySearch, DiscoveryQueryResult } from "./discovery";
import { validDiscoveryCenter } from "./discovery";
import { BAIDU_SEARCH_QUERIES, DISCOVERY_LIMITS } from "./searchMapping";

export function createBaiduDiscoverySearch(api: typeof BMap, center: MapLocation): DiscoverySearch {
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
      if (!validDiscoveryCenter(center) || !Object.values(BAIDU_SEARCH_QUERIES).some(value => value === query)) {
        resolve({ status: "provider_error" });
        return;
      }
      let search: BMap.LocalSearch | undefined;
      let settled = false;
      const finish = (result?: DiscoveryQueryResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        search?.clearResults();
        if (result) resolve(result);
        else reject(new DOMException("Discovery cancelled", "AbortError"));
      };
      const abort = () => finish();
      const timer = setTimeout(() => finish({ status: "timeout" }), DISCOVERY_LIMITS.queryTimeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      try {
        const point = new api.Point(center.longitude, center.latitude);
        search = new api.LocalSearch(point, {
          pageCapacity: DISCOVERY_LIMITS.queryPageSize,
          onSearchComplete(results) {
            if (settled) return;
            try {
              const status = search!.getStatus();
              const result = Array.isArray(results) ? results[0] : results;
              if (status === 8) { finish({ status: "timeout" }); return; }
              // UNKNOWN_LOCATION alone does not prove an empty query. Require explicit zero counts.
              if ((status === 0 || status === 2) && result?.getNumPois() === 0 && result.getCurrentNumPois() === 0) {
                finish({ status: "empty", pois: [], totalReported: 0, inspectedCount: 0 });
                return;
              }
              if (status !== 0 || !result) { finish({ status: "provider_error" }); return; }
              const count = result.getCurrentNumPois();
              const total = result.getNumPois();
              if (!Number.isInteger(count) || count < 0 || !Number.isInteger(total) || total < count) {
                finish({ status: "provider_error" }); return;
              }
              const inspectedCount = Math.min(count, DISCOVERY_LIMITS.queryPageSize);
              const pois = Array.from({ length: inspectedCount }, (_, index) => result.getPoi(index))
                .flatMap(poi => { const adapted = poi && adaptBaiduLocalResultPoi(poi); return adapted ? [adapted] : []; });
              finish({ status: "success", pois, totalReported: total, inspectedCount });
            } catch {
              finish({ status: "provider_error" });
            }
          },
        });
        search.searchNearby(query, point, DISCOVERY_LIMITS.radiusMeters);
      } catch {
        finish({ status: "provider_error" });
      }
    });
  };
}
