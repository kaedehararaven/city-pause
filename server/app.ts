import { createServer, type Server } from "node:http";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
} as const;

export function createAppServer(): Server {
  return createServer((request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.method === "GET" && url.pathname === "/api/health") {
      response.writeHead(200, jsonHeaders);
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, jsonHeaders);
    response.end(JSON.stringify({ ok: false, error: "Not found" }));
  });
}
