import type { MapLocation, RouteResult } from "../contracts/map";
import { walkingMinutesFromSeconds } from "../contracts/map";
import type {
  CandidateData,
  CandidatePlace,
  CandidateProvider,
} from "./model";

const mockOriginLocation: MapLocation = {
  latitude: 39.9,
  longitude: 116.4,
  coordinateSystem: "BD-09",
};

// All places, attributes, coordinates and routes here are fictional demo facts.
const places: CandidatePlace[] = [
  { source: "mock", provider: "mock", providerId: "rest", name: "河畔休息区", location: { ...mockOriginLocation, longitude: 116.401 }, categoryLabel: "休息区", kind: "rest", minimumStayMinutes: 5, suggestedStayMinutes: 10, costRequired: false },
  { source: "mock", provider: "mock", providerId: "park", name: "林荫公园", location: { ...mockOriginLocation, longitude: 116.402 }, categories: ["公园"], categoryLabel: "公园", kind: "park", minimumStayMinutes: 5, suggestedStayMinutes: 15, costRequired: false },
  { source: "mock", provider: "mock", providerId: "book", name: "街角书店", location: { ...mockOriginLocation, longitude: 116.403 }, categories: ["书店"], categoryLabel: "书店", kind: "book", minimumStayMinutes: 10, suggestedStayMinutes: 20, costRequired: false },
  { source: "mock", provider: "mock", providerId: "garden", name: "口袋花园", location: { ...mockOriginLocation, longitude: 116.404 }, categories: ["花园"], categoryLabel: "花园", kind: "garden", minimumStayMinutes: 5, suggestedStayMinutes: 10, costRequired: false },
  { source: "mock", provider: "mock", providerId: "cafe", name: "社区咖啡馆", location: { ...mockOriginLocation, longitude: 116.405 }, categories: ["咖啡馆"], categoryLabel: "咖啡馆", kind: "cafe", minimumStayMinutes: 15, suggestedStayMinutes: 25, costRequired: true },
  { source: "mock", provider: "mock", providerId: "lib", name: "社区图书馆", location: { ...mockOriginLocation, longitude: 116.406 }, categories: ["图书馆"], categoryLabel: "图书馆", kind: "lib", minimumStayMinutes: 10, suggestedStayMinutes: 20, costRequired: false },
];

const walk: Record<string, number> = {
  "center:rest": 2, "center:park": 3, "center:book": 4, "center:garden": 4, "center:cafe": 5, "center:lib": 6,
  "rest:park": 5, "rest:book": 5, "rest:garden": 3, "rest:cafe": 4, "rest:lib": 5,
  "park:book": 3, "park:garden": 2, "park:cafe": 4, "park:lib": 6,
  "book:garden": 4, "book:cafe": 2, "book:lib": 3,
  "garden:cafe": 6, "garden:lib": 5, "cafe:lib": 5,
};

const locations = new Map<string, MapLocation>([
  ["center", mockOriginLocation],
  ...places.map((place) => [place.providerId, place.location] as const),
]);

function mockRoute(fromId: string, toId: string, minutes: number): RouteResult {
  const fromLocation = locations.get(fromId);
  const toLocation = locations.get(toId);
  if (!fromLocation || !toLocation) throw new Error("Mock route endpoint is missing");
  const seconds = minutes * 60;
  return {
    status: "success",
    source: "mock",
    provider: "mock",
    mode: "walking",
    from: { id: fromId, location: fromLocation },
    to: { id: toId, location: toLocation },
    coordinateSystem: "BD-09",
    walkingDistanceMeters: minutes * 75,
    walkingDurationSeconds: seconds,
    walkingMinutes: walkingMinutesFromSeconds(seconds),
  };
}

const routes = Object.entries(walk).flatMap(([key, minutes]) => {
  const [from, to] = key.split(":");
  return [mockRoute(from, to, minutes), mockRoute(to, from, minutes)];
});

export function createMockCandidateData(): CandidateData {
  return {
    source: "mock",
    origin: { id: "center", name: "中心广场", location: mockOriginLocation },
    places,
    routes,
  };
}

export function createMockCandidateProvider(): CandidateProvider {
  return { source: "mock", getCandidateData: createMockCandidateData };
}
