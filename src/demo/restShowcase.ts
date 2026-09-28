import type { UserIntent } from "../recommendation/model";
import type { BuildResult } from "../route-builder/model";
import { buildMultiStop } from "../route-builder/builder";
import { familyFor } from "../route-builder/policy";
import { buildDecisionResult } from "../recommendation/engine";
import { replayMultiData } from "./multiReplay";
import type { ReplayScenario } from "./replayData";

// User-selected historical examples, not production recommendation ranking.
const dessertId = "1ea0c8eb78a592667adbd2d1";
const bookstoreId = "109bc20e7e585dda6240a982";
export async function restShowcase(result: BuildResult, intent: UserIntent, scenario: ReplayScenario, signal?: AbortSignal): Promise<BuildResult> {
  if (scenario !== "compact" || intent.activity !== "rest" || intent.availableMinutes < 45 || intent.returnMode !== "open_ended") return result;
  signal?.throwIfAborted();
  const context = replayMultiData(intent, scenario);
  const singles = buildDecisionResult(intent, context.data).recommendations;
  const pair = [dessertId, bookstoreId].flatMap(id => singles.filter(single => single.places[0]?.providerId === id));
  const validated = pair.length === 2 ? await buildMultiStop({ intent, ...context, singles: pair, signal }) : null;
  const cafe = result.routes.find(route => familyFor(route.stops[0].poi)?.path === "美食>咖啡厅");
  const dessert = validated?.routes.find(route => route.stops[0].poi.providerId === dessertId && route.stops[1].poi.providerId === bookstoreId);
  const routes = [...(cafe ? [cafe] : []), ...(dessert ? [dessert] : [])];
  return { ...result, routes, status: routes.length ? "ok" : result.status === "ok" ? "no_feasible_multi_stop" : result.status,
    audit: { ...result.audit, demoSelection: { preset: "one-cafe-and-historical-dessert", algorithmRouteCount: result.routes.length,
      displayedRouteCount: routes.length, historicalDessertValidated: !!dessert } } };
}
