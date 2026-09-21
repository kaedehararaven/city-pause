import type { MapPOI, RouteEndpoint, RouteResult } from "../contracts/map";
import type { CandidateData, CandidateProvider } from "./model";

export type RealCandidateInput = {
  origin: RouteEndpoint & { name: string };
  poi: MapPOI;
  routes: RouteResult[];
};

// Stay time is an A-side generic policy. It is not supplied by Baidu and is not
// specific to parks or any other POI category.
const defaultStayPolicy = {
  minimumStayMinutes: 5,
  suggestedStayMinutes: 15,
} as const;

export function createRealCandidateData(input: RealCandidateInput): CandidateData {
  if (input.poi.source !== "real") {
    throw new Error("Real candidate provider requires a real MapPOI");
  }

  return {
    source: "real",
    origin: input.origin,
    places: [
      {
        ...input.poi,
        categoryLabel: input.poi.categories?.join(" / "),
        // kind and costRequired stay unknown until a separate, explicit rule or
        // trustworthy data source supplies them.
        ...defaultStayPolicy,
      },
    ],
    routes: input.routes,
  };
}

export function createRealCandidateProvider(
  input: RealCandidateInput,
): CandidateProvider {
  return {
    source: "real",
    getCandidateData: () => createRealCandidateData(input),
  };
}
