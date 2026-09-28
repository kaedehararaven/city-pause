import express from "express";
import { createAppHandler } from "./app.js";

export function createMakersApp(options: Parameters<typeof createAppHandler>[0] = {}) {
  const app = express();
  app.disable("x-powered-by");
  // One handler per warm instance, not per request: preserves existing caches.
  const handle = createAppHandler(options);
  app.use((request, response) => {
    // Accept both full URLs and URLs with the platform's /api mount removed.
    const url = request.url;
    if (!/^\/api(?:\/|\?|$)/.test(url)) request.url = `/api${url.startsWith("/") ? "" : "/"}${url}`;
    void handle(request, response).catch(() => {
      if (response.headersSent) { response.end(); return; }
      response.status(500).set("Cache-Control", "no-store").json({ ok: false, error: "Internal server error" });
    });
  });
  return app;
}
