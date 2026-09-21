export type CoordinateSystem = "BD-09";
export type MapDataSource = "real" | "mock";
export type MapProvider = "baidu" | "mock";

export type MapLocation = {
  latitude: number;
  longitude: number;
  coordinateSystem: CoordinateSystem;
};

// Canonical MapPOI v0.1: facts about a place, never facts about a route.
export type MapPOI = {
  source: MapDataSource;
  provider: MapProvider;
  providerId: string;
  name: string;
  location: MapLocation;
  address?: string;
  categories?: string[];
  openingHours?: string;
  rating?: number;
};

export type RouteEndpoint = {
  id: string;
  location: MapLocation;
};

type RouteResultBase = {
  source: MapDataSource;
  provider: MapProvider;
  mode: "walking";
  from: RouteEndpoint;
  to: RouteEndpoint;
  coordinateSystem: CoordinateSystem;
};

export type SuccessfulRouteResult = RouteResultBase & {
  status: "success";
  walkingDistanceMeters: number;
  walkingDurationSeconds: number;
  // DERIVED from walkingDurationSeconds using ceil(seconds / 60).
  walkingMinutes: number;
};

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
