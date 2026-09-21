export type FetchLike = typeof fetch;

export type TemporaryWalkingRoute = {
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
  source: "baidu-place-v3-detail";
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
    providerType: optionalText(detailInfo?.type),
    detailUrl: optionalText(detailInfo?.detail_url),
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
