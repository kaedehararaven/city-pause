import type { IncomingMessage, ServerResponse } from "node:http";
import { createAppHandler } from "../server/app.js";

// Module-scoped handler preserves caches across requests in a warm instance.
const handle = createAppHandler({ serverAk: process.env.SERVER_AK });

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    await handle(request, response);
  } catch {
    if (response.headersSent) { response.end(); return; }
    response.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: false, error: "Internal server error" }));
  }
}
