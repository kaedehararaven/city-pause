import type { MapPOI } from "../contracts/map";
import type { TemporaryPlaceDetail } from "./capabilityClient";

function optionalText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function uniqueText(values: unknown[]): string[] | undefined {
  const normalized = Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        // LocalSearch may wrap matched tag text in font highlighting.
        .map((value) => value.replace(/<\/?font\b[^>]*>/gi, ""))
        .flatMap((value) => value.split(/[;/]/))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  return normalized.length ? normalized : undefined;
}

export function adaptBaiduLocalResultPoi(
  poi: BMap.LocalResultPoi,
): MapPOI | null {
  if (
    typeof poi.uid !== "string" || !poi.uid.trim() ||
    typeof poi.title !== "string" || !poi.title.trim() ||
    !poi.point ||
    !Number.isFinite(poi.point.lng) ||
    !Number.isFinite(poi.point.lat) ||
    Math.abs(poi.point.lat) > 90 || Math.abs(poi.point.lng) > 180
  ) {
    return null;
  }

  return {
    source: "real",
    provider: "baidu",
    providerId: poi.uid,
    name: poi.title,
    location: {
      longitude: poi.point.lng,
      latitude: poi.point.lat,
      coordinateSystem: "BD-09",
    },
    address: optionalText(poi.address),
    categories: Array.isArray(poi.tags) ? uniqueText(poi.tags) : undefined,
  };
}

export function mergeBaiduPlaceDetail(
  poi: MapPOI,
  detail: TemporaryPlaceDetail | undefined,
): MapPOI {
  if (!detail || detail.providerId !== poi.providerId) return poi;

  const ratingText = optionalText(detail.overallRating);
  const parsedRating = ratingText === undefined ? undefined : Number(ratingText);
  const detailCategories = uniqueText([
    ...(poi.categories ?? []),
    detail.categoryTag,
    detail.classifiedTag,
  ]);

  return {
    ...poi,
    classifiedPoiTag: detail.classifiedTag ?? poi.classifiedPoiTag,
    parentProviderId: detail.parentId ?? poi.parentProviderId,
    detailSource: detail.source === "baidu-place-v3-search" ? "place-search-v3" : "place-detail-v3",
    detailExpiresAt: detail.expiresAt ?? Date.now() + 5 * 60_000,
    address: optionalText(detail.address) ?? poi.address,
    categories: detailCategories,
    openingHours: optionalText(detail.shopHours),
    telephone: optionalText(detail.telephone),
    description: optionalText(detail.description),
    suggestedVisitDuration: optionalText(detail.suggestedTime),
    indoorFloor: optionalText(detail.indoorFloor),
    brand: optionalText(detail.brand),
    priceText: optionalText(detail.price),
    bestVisitTime: optionalText(detail.bestTime),
    detailUrl: detail.detailUrl,
    navigationLocation: detail.navigationLocation,
    subPlaces: detail.subPlaces,
    rating:
      parsedRating !== undefined && Number.isFinite(parsedRating) && parsedRating >= 0 && parsedRating <= 5
        ? parsedRating
        : undefined,
  };
}
