import { createServer, type Server, type ServerResponse } from "node:http";

import {
  BaiduProviderError,
  getPlaceDetail,
  getWalkingRoute,
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

export function createAppServer(options: AppServerOptions = {}): Server {
  const fetchImpl = options.fetchImpl ?? fetch;

  return createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/map/walking-route") {
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
        const data = await getWalkingRoute(
          {
            originLatitude,
            originLongitude,
            destinationLatitude,
            destinationLongitude,
            destinationUid: destinationUid ?? undefined,
          },
          options.serverAk,
          fetchImpl,
        );
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        const providerStatus =
          error instanceof BaiduProviderError ? error.providerStatus : undefined;
        sendJson(response, 502, {
          ok: false,
          error: "Walking route provider failed",
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
        const data = await getPlaceDetail(uid, options.serverAk, fetchImpl);
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        const providerStatus =
          error instanceof BaiduProviderError ? error.providerStatus : undefined;
        sendJson(response, 502, {
          ok: false,
          error: "Place detail provider failed",
          ...(providerStatus === undefined ? {} : { providerStatus }),
        });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  });
}
