export type FetchLike = typeof fetch;

export type TemporaryWalkingRoute = {
  geometry?: Array<Array<{ longitude: number; latitude: number; coordinateSystem: "BD-09" }>>;
  source: "baidu-direction-v2-walking";
  coordinateSystem: "BD-09";
  walkingDistanceMeters: number;
  walkingDurationSeconds: number;
  walkingMinutes: number;
  stepCount: number;
  observedRouteFields: string[];
  observedStepFields: string[];
  steps?: Array<{
    distanceMeters: number;
    durationSeconds: number;
    instruction?: string;
    roadName?: string;
  }>;
};

export type TemporaryPlaceDetail = {
  source: "baidu-place-v3-detail" | "baidu-place-v3-search";
  parentId?: string;
  providerId: string;
  name: string;
  location?: {
    latitude: number;
    longitude: number;
    coordinateSystem: "BD-09";
  };
  address?: string;
  province?: string;
  city?: string;
  area?: string;
  telephone?: string;
  businessStatus?: string;
  categoryTag?: string;
  classifiedTag?: string;
  providerType?: string;
  detailUrl?: string;
  shopHours?: string;
  price?: string;
  overallRating?: string;
  indoorFloor?: string;
  bestTime?: string;
  suggestedTime?: string;
  description?: string;
  brand?: string;
  navigationLocation?: { latitude: number; longitude: number; coordinateSystem: "BD-09" };
  subPlaces?: Array<{
    providerId: string;
    name: string;
    classifiedPoiTag?: string;
    categories?: string[];
    location?: { latitude: number; longitude: number; coordinateSystem: "BD-09" };
    address?: string;
  }>;
  observedFields: string[];
  observedDetailFields: string[];
};

export class BaiduProviderError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
    readonly routeStatus: "no_route" | "timeout" | "provider_error" = "provider_error",
  ) {
    super(message);
    this.name = "BaiduProviderError";
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function detailLocation(value: unknown): TemporaryPlaceDetail["location"] {
  if (!isObject(value)) return undefined;
  const latitude = finiteNumber(value.lat), longitude = finiteNumber(value.lng);
  return latitude !== undefined && longitude !== undefined && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude, coordinateSystem: "BD-09" } : undefined;
}

export function safePlaceDetailUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const officialPage = url.hostname === "map.baidu.com" ||
      (url.hostname === "api.map.baidu.com" && url.pathname === "/place/detail");
    if (!["https:", "http:"].includes(url.protocol) || !officialPage || url.username || url.password || url.port) return undefined;
    if ([...url.searchParams.keys()].some(key => /^(ak|key|token|access_token|authorization)$/i.test(key))) return undefined;
    url.protocol = "https:";
    return url.toString();
  } catch { return undefined; }
}

function detailChildren(value: unknown): TemporaryPlaceDetail["subPlaces"] {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const children = value.slice(0, 100).flatMap(child => {
    if (!isObject(child)) return [];
    const providerId = optionalText(child.uid), name = optionalText(child.name) ?? optionalText(child.show_name);
    if (!providerId || !name || seen.has(providerId)) return [];
    seen.add(providerId);
    const categories = [...new Set([child.classified_poi_tag, child.std_tag].flatMap(tag =>
      optionalText(tag)?.split(/[;/]/).map(part => part.trim()).filter(Boolean) ?? []))];
    return [{ providerId, name, classifiedPoiTag: optionalText(child.classified_poi_tag), categories: categories.length ? categories : undefined,
      location: detailLocation(child.location), address: optionalText(child.address) }];
  }).slice(0, 20);
  return children.length ? children : undefined;
}

function providerStatus(payload: JsonObject): number | undefined {
  return typeof payload.status === "number" && Number.isFinite(payload.status)
    ? payload.status
    : undefined;
}

function fieldTypes(value: JsonObject): string[] {
  return Object.entries(value)
    .map(([name, fieldValue]) => {
      const runtimeType = Array.isArray(fieldValue)
        ? "array"
        : fieldValue === null
          ? "null"
          : typeof fieldValue;
      return `${name}:${runtimeType}`;
    })
    .sort();
}

export function adaptWalkingRoute(payload: unknown): TemporaryWalkingRoute {
  if (!isObject(payload)) throw new BaiduProviderError("Malformed route response");

  const status = providerStatus(payload);
  if (status !== 0) {
    throw new BaiduProviderError("Baidu walking route request failed", status);
  }

  const result = isObject(payload.result) ? payload.result : undefined;
  const routes = result && Array.isArray(result.routes) ? result.routes : undefined;
  const route = routes?.find(isObject);
  if (!route) throw new BaiduProviderError("No walking route returned", status, "no_route");

  const distance = finiteNonNegative(route.distance);
  const duration = finiteNonNegative(route.duration);
  if (distance === undefined || duration === undefined) {
    throw new BaiduProviderError("Walking route lacks distance or duration", status);
  }

  const rawSteps = Array.isArray(route.steps) ? route.steps : [];
  const geometry = rawSteps.flatMap(step => {
    if (!isObject(step) || typeof step.path !== "string") return [];
    const tokens = step.path.split(";").filter(Boolean);
    if (tokens.length < 2 || tokens.length > 20000) return [];
    const points = tokens.map(token => token.split(",").map(Number));
    if (points.some(p => p.length !== 2 || !Number.isFinite(p[0]) || Math.abs(p[0]) > 180 || !Number.isFinite(p[1]) || Math.abs(p[1]) > 90)) return [];
    return [points.map(([longitude, latitude]) => ({ longitude, latitude, coordinateSystem: "BD-09" as const }))];
  });
  const steps = rawSteps.flatMap((value) => {
    if (!isObject(value)) return [];
    const stepDistance = finiteNonNegative(value.distance);
    const stepDuration = finiteNonNegative(value.duration);
    if (stepDistance === undefined || stepDuration === undefined) return [];
    return [
      {
        distanceMeters: stepDistance,
        durationSeconds: stepDuration,
        instruction: optionalText(value.instructions),
        roadName: optionalText(value.name),
      },
    ];
  });

  return {
    source: "baidu-direction-v2-walking",
    coordinateSystem: "BD-09",
    walkingDistanceMeters: distance,
    walkingDurationSeconds: duration,
    walkingMinutes: Math.ceil(duration / 60),
    stepCount: rawSteps.length,
    observedRouteFields: fieldTypes(route),
    observedStepFields: Array.from(
      new Set(rawSteps.filter(isObject).flatMap(fieldTypes)),
    ).sort(),
    steps: steps.length ? steps : undefined,
    ...(geometry.length ? { geometry } : {}),
  };
}

export function adaptPlaceDetail(payload: unknown): TemporaryPlaceDetail {
  if (!isObject(payload)) throw new BaiduProviderError("Malformed place response");

  const status = providerStatus(payload);
  if (status !== 0) {
    throw new BaiduProviderError("Baidu place detail request failed", status);
  }

  const firstResult = Array.isArray(payload.results)
    ? payload.results.find(isObject)
    : isObject(payload.result)
      ? payload.result
      : isObject(payload.results)
        ? payload.results
        : undefined;
  if (!firstResult) throw new BaiduProviderError("No place detail returned", status);

  const providerId = optionalText(firstResult.uid);
  const name = optionalText(firstResult.name);
  if (!providerId || !name) {
    throw new BaiduProviderError("Place detail lacks identity", status);
  }

  const rawLocation = isObject(firstResult.location) ? firstResult.location : undefined;
  const latitude = rawLocation && finiteNumber(rawLocation.lat);
  const longitude = rawLocation && finiteNumber(rawLocation.lng);
  const validLocation =
    latitude !== undefined &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude !== undefined &&
    longitude >= -180 &&
    longitude <= 180;
  const detailInfo = isObject(firstResult.detail_info)
    ? firstResult.detail_info
    : undefined;
  const explicitBusinessStatus = Object.hasOwn(firstResult, "status")
    ? firstResult.status === ""
      ? "normal"
      : optionalText(firstResult.status)
    : undefined;

  return {
    source: "baidu-place-v3-detail",
    providerId,
    name,
    location: validLocation
      ? {
          latitude,
          longitude,
          coordinateSystem: "BD-09",
        }
      : undefined,
    address: optionalText(firstResult.address),
    province: optionalText(firstResult.province),
    city: optionalText(firstResult.city),
    area: optionalText(firstResult.area),
    telephone: optionalText(firstResult.telephone),
    businessStatus: explicitBusinessStatus,
    categoryTag: optionalText(detailInfo?.tag),
    classifiedTag: optionalText(detailInfo?.classified_poi_tag),
    parentId: optionalText(detailInfo?.parent_id),
    providerType: optionalText(detailInfo?.type),
    detailUrl: safePlaceDetailUrl(detailInfo?.detail_url),
    brand: optionalText(detailInfo?.brand),
    navigationLocation: detailLocation(detailInfo?.navi_location),
    subPlaces: detailChildren(detailInfo?.children),
    shopHours: optionalText(detailInfo?.shop_hours),
    price: optionalText(detailInfo?.price),
    overallRating: optionalText(detailInfo?.overall_rating),
    indoorFloor: optionalText(detailInfo?.indoor_floor),
    bestTime: optionalText(detailInfo?.best_time),
    suggestedTime: optionalText(detailInfo?.sug_time),
    description: optionalText(detailInfo?.description),
    observedFields: fieldTypes(firstResult),
    observedDetailFields: detailInfo ? fieldTypes(detailInfo) : [],
  };
}

async function fetchBaiduJson(
  path: string,
  params: Record<string, string>,
  serverAk: string,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const url = new URL(path, "https://api.map.baidu.com");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("ak", serverAk);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new BaiduProviderError(
      "Baidu request unavailable",
      undefined,
      timedOut ? "timeout" : "provider_error",
    );
  }

  if (!response.ok) {
    throw new BaiduProviderError("Baidu returned an HTTP error");
  }

  try {
    return await response.json();
  } catch {
    throw new BaiduProviderError("Baidu returned invalid JSON");
  }
}

export async function getWalkingRoute(
  input: {
    originLatitude: number;
    originLongitude: number;
    destinationLatitude: number;
    destinationLongitude: number;
    destinationUid?: string;
  },
  serverAk: string,
  fetchImpl: FetchLike = fetch,
): Promise<TemporaryWalkingRoute> {
  const payload = await fetchBaiduJson(
    "/direction/v2/walking",
    {
      origin: `${input.originLatitude.toFixed(6)},${input.originLongitude.toFixed(6)}`,
      destination: `${input.destinationLatitude.toFixed(6)},${input.destinationLongitude.toFixed(6)}`,
      ...(input.destinationUid ? { destination_uid: input.destinationUid } : {}),
      coord_type: "bd09ll",
      ret_coordtype: "bd09ll",
      output: "json",
    },
    serverAk,
    fetchImpl,
  );
  return adaptWalkingRoute(payload);
}

export function adaptPlaceSearch(payload: unknown): { places: TemporaryPlaceDetail[]; total: number; rawResultCount: number } {
  if (!isObject(payload) || providerStatus(payload) !== 0) throw new BaiduProviderError("Place search failed", isObject(payload) ? providerStatus(payload) : undefined);
  if (!Array.isArray(payload.results)) throw new BaiduProviderError("Invalid search results");
  const places = payload.results.flatMap(item => {
    try {
      const detail = adaptPlaceDetail({ status: 0, results: [item] });
      return detail.location ? [{ ...detail, source: "baidu-place-v3-search" as const }] : [];
    } catch { return []; }
  });
  return { places, total: typeof payload.total === "number" ? payload.total : payload.results.length, rawResultCount: payload.results.length };
}

export async function getPlaceAround(input: { keywords: string[]; latitude: number; longitude: number; radius: number; page?: number }, serverAk: string, fetchImpl: FetchLike = fetch) {
  const payload = await fetchBaiduJson("/place/v3/around", {
    query: input.keywords.join("$"), location: `${input.latitude},${input.longitude}`, radius: String(input.radius),
    scope: "2", page_size: "20", page_num: String(input.page ?? 0), coord_type: "3", radius_limit: "true", output: "json",
  }, serverAk, fetchImpl);
  return adaptPlaceSearch(payload);
}

export async function getPlaceDetails(uids: string[], serverAk: string, fetchImpl: FetchLike = fetch): Promise<TemporaryPlaceDetail[]> {
  const payload = await fetchBaiduJson("/place/v3/detail", { uids: uids.join(","), scope: "2", output: "json" }, serverAk, fetchImpl);
  if (!isObject(payload) || providerStatus(payload) !== 0) throw new BaiduProviderError("Batch detail failed", isObject(payload) ? providerStatus(payload) : undefined);
  if (!Array.isArray(payload.results)) throw new BaiduProviderError("Invalid batch results");
  return payload.results.flatMap(item => {
    try { const detail = adaptPlaceDetail({ status: 0, results: [item] }); return uids.includes(detail.providerId) ? [detail] : []; }
    catch { return []; }
  });
}

export async function getPlaceDetail(
  uid: string,
  serverAk: string,
  fetchImpl: FetchLike = fetch,
): Promise<TemporaryPlaceDetail> {
  const payload = await fetchBaiduJson(
    "/place/v3/detail",
    {
      uid,
      scope: "2",
      extensions_adcode: "true",
      output: "json",
    },
    serverAk,
    fetchImpl,
  );
  return adaptPlaceDetail(payload);
}

export function adaptCyclingRoute(payload: unknown) {
  if (!isObject(payload)) throw new BaiduProviderError("Malformed cycling response");
  const status = providerStatus(payload);
  if (status !== 0) throw new BaiduProviderError("Cycling provider failed", status, status === 2001 ? "no_route" : "provider_error");
  const result = isObject(payload.result) ? payload.result : undefined;
  const route = result && Array.isArray(result.routes) ? result.routes.find(isObject) : undefined;
  if (!route) throw new BaiduProviderError("No cycling route", status, "no_route");
  const distanceMeters = finiteNonNegative(route.distance), durationSeconds = finiteNonNegative(route.duration);
  if (distanceMeters === undefined || durationSeconds === undefined) throw new BaiduProviderError("Malformed cycling metrics");
  return { source: "baidu-direction-v2-riding" as const, mode: "cycling" as const, coordinateSystem: "BD-09" as const,
    distanceMeters, durationSeconds, durationMinutes: durationSeconds / 60 };
}

export async function getCyclingRoute(input: Parameters<typeof getWalkingRoute>[0], serverAk: string, fetchImpl: FetchLike = fetch) {
  return adaptCyclingRoute(await fetchBaiduJson("/direction/v2/riding", {
    origin: `${input.originLatitude.toFixed(6)},${input.originLongitude.toFixed(6)}`,
    destination: `${input.destinationLatitude.toFixed(6)},${input.destinationLongitude.toFixed(6)}`,
    ...(input.destinationUid ? { destination_uid: input.destinationUid } : {}),
    coord_type: "bd09ll", ret_coordtype: "bd09ll", output: "json", riding_type: "0",
  }, serverAk, fetchImpl));
}
