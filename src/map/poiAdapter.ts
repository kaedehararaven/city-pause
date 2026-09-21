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
    !poi.uid ||
    !poi.title ||
    !poi.point ||
    !Number.isFinite(poi.point.lng) ||
    !Number.isFinite(poi.point.lat)
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
    address: optionalText(detail.address) ?? poi.address,
    categories: detailCategories,
    openingHours: optionalText(detail.shopHours),
    rating:
      parsedRating !== undefined && Number.isFinite(parsedRating)
        ? parsedRating
        : undefined,
  };
}
