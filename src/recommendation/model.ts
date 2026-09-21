import type {
  MapDataSource,
  MapPOI,
  RouteEndpoint,
  RouteResult,
  SuccessfulRouteResult,
} from "../contracts/map";

import type { DiscoveredCandidate } from "../contracts/discovery";
import type { ScoreTrace } from "./utility";

export type ReturnMode = "open_ended" | "return_to_start";

export type Activity = "rest" | "walk" | "explore";
export type OriginOfIntent = "form" | "button" | "checkbox" | "text-rule" | "default" | "unspecified";

export type UserIntent = {
  availableMinutes: number;
  activity: Activity;
  returnMode: ReturnMode;
  avoidCost: boolean;
  nearby: boolean;
  excludedKinds: string[];
  rawText: string;
  source: {
    availableMinutes: OriginOfIntent;
    activity: OriginOfIntent;
    returnMode: OriginOfIntent;
    avoidCost: OriginOfIntent;
    nearby: OriginOfIntent;
    excludedKinds: OriginOfIntent;
  };
};

// These fields are recommendation policy/enrichment, not MapPOI facts.
export type CandidatePlace = MapPOI & {
  categoryLabel?: string;
  kind?: string;
  costRequired?: boolean;
  minimumStayMinutes: number;
  suggestedStayMinutes: number;
  stayAllocation?: "flexible";
};
export type CandidateData = {
  source: MapDataSource;
  origin: RouteEndpoint & { name: string };
  places: CandidatePlace[];
  routes: RouteResult[];
  // Discovery provenance, separate from provider facts. Optional for legacy callers.
  discoveredCandidates?: DiscoveredCandidate[];
};
export type CandidateProvider = {
  source: MapDataSource;
  getCandidateData: () => CandidateData;
};
export type PlanStep = { kind: "步行" | "停留" | "返程" | "缓冲"; label: string; minutes: number };
export type CandidatePlan = {
  id: string;
  title: string;
  places: CandidatePlace[];
  routes: SuccessfulRouteResult[];
  steps: PlanStep[];
  outboundWalkingMinutes: number;
  returnWalkingMinutes?: number;
  bufferMinutes: number;
  remainingMinutes: number;
  walkingMinutes: number;
  stayMinutes: number;
  totalMinutes: number;
  budgetMinutes: number;
  returnMode: ReturnMode;
  costStatus: "required" | "not-required" | "unknown";
  source: CandidateData["source"];
  originName: string;
  feasibility: "feasible";
  categoryCount: number;
};
export type Recommendation = Omit<CandidatePlan, "categoryCount"> & {
  strategyId: "easy" | "balanced" | "explore";
  strategyLabel: string;
  strategyReason: string;
  scoreTrace?: ScoreTrace;
};
