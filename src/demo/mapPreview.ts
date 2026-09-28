import capture from "./public-map-capture.json";
import type { SuccessfulRouteResult } from "../contracts/map";
import type { JourneyPlan } from "../route-builder/MultiStopResults";
import { sameEndpoint } from "../route-builder/edges";

export function demoMapPreview(plan: JourneyPlan): JourneyPlan {
  return { ...plan, previewCapturedAt: capture.capturedAt, routes: plan.routes.map(route => {
    if (route.geometry?.length) return route;
    const preview = (capture.routes as SuccessfulRouteResult[]).find(saved => saved.mode === route.mode && sameEndpoint(saved.from, route.from) && sameEndpoint(saved.to, route.to));
    // Geometry is presentation-only. Preserve the historical planning metrics.
    return preview?.geometry ? { ...route, geometry: preview.geometry } : route;
  }) };
}
