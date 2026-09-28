import type { RouteEndpoint, RouteResult } from "../contracts/map";
import { walkingMinutesFromSeconds, validRouteMetrics } from "../contracts/map";

type WalkingRoutePayload = {
  geometry?: import("../contracts/map").MapLocation[][];
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
  observedAt?: number;
  expiresAt?: number;
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
  navigationLocation?: import("../contracts/map").MapLocation;
  subPlaces?: import("../contracts/map").MapSubPlace[];
  observedFields: string[];
  observedDetailFields: string[];
};

async function requestCapability<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("data" in payload)
  ) {
    const routeStatus =
      typeof payload === "object" &&
      payload !== null &&
      "routeStatus" in payload &&
      (payload.routeStatus === "no_route" ||
        payload.routeStatus === "timeout" ||
        payload.routeStatus === "provider_error")
        ? payload.routeStatus
        : undefined;
    const providerStatus = typeof payload === "object" && payload !== null && "providerStatus" in payload && typeof payload.providerStatus === "number" ? payload.providerStatus : undefined;
    throw new CapabilityRequestError(routeStatus, response.status, providerStatus);
  }
  return payload.data as T;
}

class CapabilityRequestError extends Error {
  constructor(
    readonly routeStatus?: "no_route" | "timeout" | "provider_error",
    readonly httpStatus?: number,
    readonly providerStatus?: number,
  ) {
    super("Map capability request failed");
  }
}

export class PlaceDetailError extends Error {
  constructor(readonly code: string, readonly serviceFailure = false) {
    super(code);
  }
}

export function detailFailure(error: unknown): PlaceDetailError {
  if (error instanceof PlaceDetailError) return error;
  if (error instanceof CapabilityRequestError) {
    const code = error.providerStatus !== undefined ? `provider_${error.providerStatus}` : `http_${error.httpStatus ?? "unknown"}`;
    return new PlaceDetailError(code, error.httpStatus === 503 || error.httpStatus === 429 || (error.providerStatus !== undefined && [2, 3, 4, 5, 101, 102, 200, 201, 202, 210, 211, 220, 240, 302].includes(error.providerStatus)));
  }
  if (error instanceof DOMException && error.name === "TimeoutError") return new PlaceDetailError("timeout");
  if (error instanceof TypeError) return new PlaceDetailError("network_unavailable");
  return new PlaceDetailError("invalid_response");
}

export async function fetchWalkingRoute(input: {
  from: RouteEndpoint;
  to: RouteEndpoint;
  destinationUid?: string;
}): Promise<RouteResult> {
  const query = new URLSearchParams({
    originLat: String(input.from.location.latitude),
    originLng: String(input.from.location.longitude),
    destinationLat: String(input.to.location.latitude),
    destinationLng: String(input.to.location.longitude),
  });
  if (input.destinationUid) query.set("destinationUid", input.destinationUid);
  try {
    const payload = await requestCapability<WalkingRoutePayload>(
      `/api/map/walking-route?${query.toString()}`,
    );
    if (
      payload.coordinateSystem !== "BD-09" ||
      !Number.isFinite(payload.walkingDistanceMeters) ||
      payload.walkingDistanceMeters < 0 ||
      !Number.isFinite(payload.walkingDurationSeconds) ||
      payload.walkingDurationSeconds < 0
    ) {
      throw new Error("Invalid route payload");
    }
    return {
      status: "success",
      source: "real",
      provider: "baidu",
      mode: "walking",
      from: input.from,
      to: input.to,
      coordinateSystem: "BD-09",
      walkingDistanceMeters: payload.walkingDistanceMeters,
      walkingDurationSeconds: payload.walkingDurationSeconds,
      walkingMinutes: walkingMinutesFromSeconds(payload.walkingDurationSeconds),
      distanceMeters: payload.walkingDistanceMeters,
      durationSeconds: payload.walkingDurationSeconds,
      durationMinutes: payload.walkingDurationSeconds / 60,
      ...(payload.geometry ? { geometry: payload.geometry } : {}),
    };
  } catch (error) {
    return {
      status:
        error instanceof CapabilityRequestError && error.routeStatus
          ? error.routeStatus
          : error instanceof DOMException && error.name === "TimeoutError"
          ? "timeout"
          : "provider_error",
      source: "real",
      provider: "baidu",
      mode: "walking",
      from: input.from,
      to: input.to,
      coordinateSystem: "BD-09",
    };
  }
}

export async function fetchRequiredRoutes(
  input: Parameters<typeof fetchWalkingRoute>[0],
  returnMode: import("../recommendation/model").ReturnMode = "open_ended",
  cached: RouteResult[] = [],
): Promise<RouteResult[]> {
  const getRoute = (request: Parameters<typeof fetchWalkingRoute>[0]) =>
    cached.find(route => route.status === "success" &&
      route.mode === "walking" && route.source === "real" && route.provider === "baidu" &&
      route.coordinateSystem === "BD-09" && validRouteMetrics(route) &&
      route.from.location.coordinateSystem === request.from.location.coordinateSystem &&
      route.to.location.coordinateSystem === request.to.location.coordinateSystem &&
      route.from.id === request.from.id && route.to.id === request.to.id &&
      route.from.location.latitude === request.from.location.latitude &&
      route.from.location.longitude === request.from.location.longitude &&
      route.to.location.latitude === request.to.location.latitude &&
      route.to.location.longitude === request.to.location.longitude) ?? fetchWalkingRoute(request);
  return Promise.all([
    getRoute(input),
    ...(returnMode === "return_to_start"
      ? [getRoute({ from: input.to, to: input.from })]
      : []),
  ]);
}

export async function fetchPlaceDetail(uid: string) {
  const query = new URLSearchParams({ uid });
  try {
    const detail = await requestCapability<TemporaryPlaceDetail>(`/api/map/place-detail?${query.toString()}`);
    if (!detail || detail.source !== "baidu-place-v3-detail" || typeof detail.name !== "string" || typeof detail.providerId !== "string") throw new PlaceDetailError("invalid_response");
    if (detail.providerId !== uid) throw new PlaceDetailError("identity_mismatch");
    return detail;
  } catch (error) { throw detailFailure(error); }
}

export async function fetchPlaceAround(center: import("../contracts/map").MapLocation, radius: number, keywords: string[], page = 0) {
  const query = new URLSearchParams({ lat: String(center.latitude), lng: String(center.longitude), radius: String(radius), query: keywords.join("$"), page: String(page) });
  return requestCapability<{ places: TemporaryPlaceDetail[]; total: number; rawResultCount: number; observedAt: number; expiresAt: number }>(`/api/map/place-around?${query}`);
}

export async function fetchBatchPlaceDetails(pois: import("../contracts/map").MapPOI[]) {
  const query = new URLSearchParams({ uids: [...new Set(pois.map(p => p.providerId))].join(",") });
  return requestCapability<{ places: TemporaryPlaceDetail[]; missingCount: number; providerStatus?: number }>(`/api/map/place-details?${query}`);
}

export async function fetchCyclingRoute(input: Parameters<typeof fetchWalkingRoute>[0]): Promise<RouteResult> {
  const base = { source: "real", provider: "baidu", mode: "cycling", coordinateSystem: "BD-09", from: input.from, to: input.to } as const;
  const query = new URLSearchParams({ originLat: String(input.from.location.latitude), originLng: String(input.from.location.longitude),
    destinationLat: String(input.to.location.latitude), destinationLng: String(input.to.location.longitude) });
  if (input.destinationUid) query.set("destinationUid", input.destinationUid);
  try {
    const payload = await requestCapability<{ source: string; mode: string; coordinateSystem: string; distanceMeters: number; durationSeconds: number; durationMinutes: number }>(`/api/map/cycling-route?${query}`);
    if (payload.source !== "baidu-direction-v2-riding" || payload.mode !== "cycling" || payload.coordinateSystem !== "BD-09" ||
        !Number.isFinite(payload.distanceMeters) || payload.distanceMeters < 0 || !Number.isFinite(payload.durationSeconds) || payload.durationSeconds < 0 ||
        payload.durationMinutes !== payload.durationSeconds / 60) throw new Error("Invalid cycling payload");
    return { ...base, status: "success", distanceMeters: payload.distanceMeters, durationSeconds: payload.durationSeconds, durationMinutes: payload.durationMinutes };
  } catch (error) {
    return { ...base, status: error instanceof CapabilityRequestError && error.routeStatus ? error.routeStatus :
      error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "provider_error" };
  }
}
