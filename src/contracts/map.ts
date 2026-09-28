export type CoordinateSystem = "BD-09";
export type MapDataSource = "real" | "mock";
export type MapProvider = "baidu" | "mock";
export type TravelMode = "walking" | "cycling";

export type MapLocation = {
  latitude: number;
  longitude: number;
  coordinateSystem: CoordinateSystem;
};

export type MapSubPlace = {
  providerId: string;
  name: string;
  classifiedPoiTag?: string;
  categories?: string[];
  location?: MapLocation;
  address?: string;
};

// Canonical MapPOI: facts about a place, never facts about a route.
export type MapPOI = {
  classifiedPoiTag?: string;
  parentProviderId?: string;
  detailSource?: "place-search-v3" | "place-detail-v3";
  detailExpiresAt?: number;
  source: MapDataSource;
  provider: MapProvider;
  providerId: string;
  name: string;
  location: MapLocation;
  address?: string;
  categories?: string[];
  openingHours?: string;
  rating?: number;
  telephone?: string;
  description?: string;
  suggestedVisitDuration?: string;
  indoorFloor?: string;
  brand?: string;
  priceText?: string;
  bestVisitTime?: string;
  detailUrl?: string;
  navigationLocation?: MapLocation;
  subPlaces?: MapSubPlace[];
};

export type RouteEndpoint = {
  id: string;
  location: MapLocation;
};

type RouteResultBase = {
  source: MapDataSource;
  provider: MapProvider;
  mode: TravelMode;
  from: RouteEndpoint;
  to: RouteEndpoint;
  coordinateSystem: CoordinateSystem;
};

export type RouteMetrics = { distanceMeters: number; durationSeconds: number; durationMinutes: number };
export type SuccessfulRouteResult = RouteResultBase & {
  status: "success";
} & (({
  mode: "walking";
  walkingDistanceMeters: number;
  walkingDurationSeconds: number;
  // DERIVED from walkingDurationSeconds using ceil(seconds / 60).
  walkingMinutes: number;
} & Partial<RouteMetrics>) | (RouteMetrics & {
  mode: "cycling";
  walkingDistanceMeters?: never;
  walkingDurationSeconds?: never;
  walkingMinutes?: never;
}));

export function routeMetrics(route: SuccessfulRouteResult): RouteMetrics {
  return route.mode === "walking" ? {
    distanceMeters: route.distanceMeters ?? route.walkingDistanceMeters,
    durationSeconds: route.durationSeconds ?? route.walkingDurationSeconds,
    durationMinutes: route.durationMinutes ?? route.walkingDurationSeconds / 60,
  } : { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, durationMinutes: route.durationMinutes };
}

export function validRouteMetrics(route: SuccessfulRouteResult): boolean {
  const m = routeMetrics(route);
  return Number.isFinite(m.distanceMeters) && m.distanceMeters >= 0 && Number.isFinite(m.durationSeconds) && m.durationSeconds >= 0 &&
    m.durationMinutes === m.durationSeconds / 60 && (route.mode !== "walking" || (
      route.walkingDistanceMeters === m.distanceMeters && route.walkingDurationSeconds === m.durationSeconds &&
      route.walkingMinutes === Math.ceil(m.durationSeconds / 60)));
}

export type FailedRouteResult = RouteResultBase & {
  status: "no_route" | "timeout" | "provider_error";
};

export type RouteResult = SuccessfulRouteResult | FailedRouteResult;

export function walkingMinutesFromSeconds(seconds: number) {
  return Math.ceil(seconds / 60);
}

export function isSuccessfulRoute(
  route: RouteResult,
): route is SuccessfulRouteResult {
  return route.status === "success";
}
