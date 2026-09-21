import type { RouteEndpoint, RouteResult } from "../contracts/map";
import { walkingMinutesFromSeconds } from "../contracts/map";

type WalkingRoutePayload = {
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
    throw new CapabilityRequestError(routeStatus);
  }
  return payload.data as T;
}

class CapabilityRequestError extends Error {
  constructor(
    readonly routeStatus?: "no_route" | "timeout" | "provider_error",
  ) {
    super("Map capability request failed");
  }
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

export function fetchPlaceDetail(uid: string) {
  const query = new URLSearchParams({ uid });
  return requestCapability<TemporaryPlaceDetail>(
    `/api/map/place-detail?${query.toString()}`,
  );
}
