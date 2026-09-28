import type { MapLocation, MapPOI } from "../contracts/map";
import type { DiscoverySearch } from "./discovery";
import { fetchPlaceAround, detailFailure } from "./capabilityClient";
import { mergeBaiduPlaceDetail } from "./poiAdapter";

export function createWebPlaceSearch(center: MapLocation, radius: number, fetchPage = fetchPlaceAround): DiscoverySearch {
  return async (query, signal) => {
    signal.throwIfAborted();
    const pois: MapPOI[] = [];
    let rawResultCount = 0, rawResultSetCount = 0, totalReported = 0, errorCode: string | undefined;
    // Keep the same combined query. The server serializes and paces page requests.
    for (let page = 0; page < 3; page++) {
      signal.throwIfAborted();
      try {
        const data = await fetchPage(center, radius, Array.isArray(query) ? query : [query], page);
        signal.throwIfAborted();
        rawResultSetCount++;
        rawResultCount += data.rawResultCount;
        totalReported = data.total;
        pois.push(...data.places.flatMap(detail => detail.location ? [mergeBaiduPlaceDetail({ source: "real", provider: "baidu", providerId: detail.providerId, name: detail.name, location: detail.location } satisfies MapPOI,
          { ...detail, observedAt: data.observedAt, expiresAt: data.expiresAt })] : []));
        if (data.rawResultCount < 20 || (page + 1) * 20 >= data.total) break;
      } catch (error) {
        signal.throwIfAborted();
        errorCode = detailFailure(error).code;
        break;
      }
    }
    if (!rawResultSetCount && errorCode) return { status: "provider_error", errorCode };
    return { status: pois.length ? "success" : "empty", pois, totalReported, inspectedCount: rawResultCount,
      rawResultCount, rawResultSetCount, adapterInputCount: pois.length, ...(errorCode ? { errorCode } : {}) };
  };
}
