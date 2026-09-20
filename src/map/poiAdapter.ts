export type TemporaryMapPoi = {
  source: "baidu-jsapi-local-search";
  providerId: string;
  name: string;
  location: {
    longitude: number;
    latitude: number;
    coordinateSystem: "BD-09";
  };
  address?: string;
  city?: string;
  province?: string;
  telephone?: string;
  categoryTags?: string[];
  providerType?: number;
  adcode?: string;
  detailUrl?: string;
};

function optionalText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalCode(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return optionalText(value);
}

export function adaptBaiduLocalResultPoi(
  poi: BMap.LocalResultPoi,
): TemporaryMapPoi | null {
  if (
    !poi.uid ||
    !poi.title ||
    !poi.point ||
    !Number.isFinite(poi.point.lng) ||
    !Number.isFinite(poi.point.lat)
  ) {
    return null;
  }

  const categoryTags = Array.isArray(poi.tags)
    ? poi.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : undefined;
  const providerType =
    typeof poi.type === "number" && Number.isFinite(poi.type)
      ? poi.type
      : undefined;

  return {
    source: "baidu-jsapi-local-search",
    providerId: poi.uid,
    name: poi.title,
    location: {
      longitude: poi.point.lng,
      latitude: poi.point.lat,
      coordinateSystem: "BD-09",
    },
    address: optionalText(poi.address),
    city: optionalText(poi.city),
    province: optionalText(poi.province),
    telephone: optionalText(poi.phoneNumber),
    categoryTags: categoryTags?.length ? categoryTags : undefined,
    providerType,
    adcode: optionalCode(poi.adcode),
    detailUrl: optionalText(poi.detailUrl),
  };
}
