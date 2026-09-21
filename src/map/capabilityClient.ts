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

async function requestCapability<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const payload: unknown = await response.json().catch(() => undefined);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("data" in payload)
  ) {
    throw new Error("Map capability request failed");
  }
  return payload.data as T;
}

export function fetchWalkingRoute(input: {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  destinationUid: string;
}) {
  const query = new URLSearchParams({
    originLat: String(input.originLatitude),
    originLng: String(input.originLongitude),
    destinationLat: String(input.destinationLatitude),
    destinationLng: String(input.destinationLongitude),
    destinationUid: input.destinationUid,
  });
  return requestCapability<TemporaryWalkingRoute>(
    `/api/map/walking-route?${query.toString()}`,
  );
}

export function fetchPlaceDetail(uid: string) {
  const query = new URLSearchParams({ uid });
  return requestCapability<TemporaryPlaceDetail>(
    `/api/map/place-detail?${query.toString()}`,
  );
}
