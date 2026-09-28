import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createPlaceDetailCache, PlaceDetailBusyError } from "./placeDetailCache.js";

import {
  BaiduProviderError,
  getPlaceDetail,
  getPlaceAround,
  getPlaceDetails,
  getWalkingRoute,
  getCyclingRoute,
  type FetchLike,
} from "./baiduMapService.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

type AppServerOptions = {
  serverAk?: string;
  fetchImpl?: FetchLike;
};

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(payload));
}

function coordinate(value: string | null, minimum: number, maximum: number) {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function validUid(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function createAppHandler(options: AppServerOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const placeDetail = createPlaceDetailCache(uid => getPlaceDetail(uid, options.serverAk!, fetchImpl), undefined, undefined,
    async uids => new Map((await getPlaceDetails(uids, options.serverAk!, fetchImpl)).map(detail => [detail.providerId, detail])));
  const placeSearch = createPlaceDetailCache(async (key: string) => getPlaceAround(JSON.parse(key), options.serverAk!, fetchImpl));
  const routeCache = new Map<string, { expires: number; data: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastRouteStarted = 0;

  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && ["/api/map/place-around", "/api/map/place-details"].includes(url.pathname)) {
      const isSearch = url.pathname.endsWith("place-around");
      const latitude = coordinate(url.searchParams.get("lat"), -90, 90), longitude = coordinate(url.searchParams.get("lng"), -180, 180);
      const radius = coordinate(url.searchParams.get("radius"), 1, 12000);
      const page = Number(url.searchParams.get("page") ?? "0");
      const keywords = (url.searchParams.get("query") ?? "").split("$");
      const uids = [...new Set((url.searchParams.get("uids") ?? "").split(","))];
      if (isSearch ? !Number.isInteger(page) || page < 0 || page > 2 || latitude === undefined || longitude === undefined || radius === undefined || keywords.length > 10 || keywords.some(k => !k.trim() || k.length > 60) : uids.length > 10 || uids.some(uid => !validUid(uid))) {
        sendJson(response, 400, { ok: false, error: "Invalid place parameters" }); return;
      }
      if (!options.serverAk) { sendJson(response, 503, { ok: false, error: "Map service is not configured" }); return; }
      try {
        if (isSearch) {
          const data = await placeSearch(JSON.stringify({ keywords, latitude, longitude, radius, page }));
          sendJson(response, 200, { ok: true, data });
        } else {
          const results = await placeDetail.batch(uids);
          const firstFailure = results.find(item => item.status === "rejected");
          sendJson(response, 200, { ok: true, data: {
            places: results.flatMap(item => item.status === "fulfilled" ? [item.value] : []),
            missingCount: results.filter(item => item.status === "rejected").length,
            providerStatus: firstFailure?.status === "rejected" && firstFailure.reason instanceof BaiduProviderError ? firstFailure.reason.providerStatus : undefined,
          } });
        }
      } catch (error) {
        sendJson(response, error instanceof PlaceDetailBusyError ? 429 : 502, { ok: false, error: "Place provider failed", ...(error instanceof BaiduProviderError ? { providerStatus: error.providerStatus } : {}) });
      }
      return;
    }

    if (request.method === "GET" && ["/api/map/walking-route", "/api/map/cycling-route"].includes(url.pathname)) {
      const originLatitude = coordinate(url.searchParams.get("originLat"), -90, 90);
      const originLongitude = coordinate(url.searchParams.get("originLng"), -180, 180);
      const destinationLatitude = coordinate(
        url.searchParams.get("destinationLat"),
        -90,
        90,
      );
      const destinationLongitude = coordinate(
        url.searchParams.get("destinationLng"),
        -180,
        180,
      );
      const destinationUid = url.searchParams.get("destinationUid");

      if (
        originLatitude === undefined ||
        originLongitude === undefined ||
        destinationLatitude === undefined ||
        destinationLongitude === undefined ||
        (destinationUid !== null && !validUid(destinationUid))
      ) {
        sendJson(response, 400, { ok: false, error: "Invalid route parameters" });
        return;
      }
      if (!options.serverAk) {
        sendJson(response, 503, { ok: false, error: "Map service is not configured" });
        return;
      }

      try {
        const input =
          {
            originLatitude,
            originLongitude,
            destinationLatitude,
            destinationLongitude,
            destinationUid: destinationUid ?? undefined,
          };
        const cacheKey = JSON.stringify([url.pathname, input]);
        const cached = routeCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) { sendJson(response, 200, { ok: true, data: cached.data }); return; }
        if (pending.size >= 32 && !pending.has(cacheKey)) { sendJson(response, 429, { ok: false, routeStatus: "provider_error", error: "Route queue full" }); return; }
        let work = pending.get(cacheKey);
        if (!work) {
          work = queue.then(async () => {
            const delay = Math.max(0, lastRouteStarted + 400 - Date.now());
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            lastRouteStarted = Date.now();
            const data = await (url.pathname === "/api/map/cycling-route" ? getCyclingRoute : getWalkingRoute)(input, options.serverAk!, fetchImpl);
            if (routeCache.size >= 128) routeCache.delete(routeCache.keys().next().value!);
            routeCache.set(cacheKey, { data, expires: Date.now() + 300_000 });
            return data;
          }).finally(() => pending.delete(cacheKey));
          pending.set(cacheKey, work);
          queue = work.catch(() => undefined);
        }
        const data = await work;
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        const providerStatus =
          error instanceof BaiduProviderError ? error.providerStatus : undefined;
        const routeStatus =
          error instanceof BaiduProviderError
            ? error.routeStatus
            : "provider_error";
        sendJson(response, routeStatus === "no_route" ? 404 : routeStatus === "timeout" ? 504 : 502, {
          ok: false,
          error: url.pathname === "/api/map/cycling-route" ? "Cycling route provider failed" : "Walking route provider failed",
          routeStatus,
          ...(providerStatus === undefined ? {} : { providerStatus }),
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/map/place-detail") {
      const uid = url.searchParams.get("uid");
      if (!validUid(uid)) {
        sendJson(response, 400, { ok: false, error: "Invalid uid" });
        return;
      }
      if (!options.serverAk) {
        sendJson(response, 503, { ok: false, error: "Map service is not configured" });
        return;
      }

      try {
        const data = await placeDetail(uid);
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        const providerStatus =
          error instanceof BaiduProviderError ? error.providerStatus : undefined;
        sendJson(response, error instanceof PlaceDetailBusyError ? 429 : 502, {
          ok: false,
          error: "Place detail provider failed",
          ...(providerStatus === undefined ? {} : { providerStatus }),
        });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  };
}

export function createAppServer(options: AppServerOptions = {}): Server {
  return createServer(createAppHandler(options));
}
