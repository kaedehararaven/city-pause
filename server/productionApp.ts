import express from "express";
import { resolve } from "node:path";
import { createAppHandler } from "./app.js";

export function createProductionApp(options: Parameters<typeof createAppHandler>[0] = {}, directory = resolve("dist")) {
  const app = express();
  app.disable("x-powered-by");
  const api = createAppHandler(options);
  // Dispatch before static serving; unknown API paths must remain JSON 404s.
  app.use((request, response, next) => {
    if (request.path !== "/api" && !request.path.startsWith("/api/")) { next(); return; }
    void api(request, response).catch(next);
  });
  app.use(express.static(directory, { dotfiles: "deny", index: false,
    setHeaders(response) { response.setHeader("Cache-Control", "no-cache"); } }));
  app.use((request, response, next) => {
    if (!["GET", "HEAD"].includes(request.method) || !request.accepts("html") ||
        request.path.startsWith("/assets/") || request.path.split("/").some(part => part.startsWith("."))) {
      response.status(404).end(); return;
    }
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(resolve(directory, "index.html"), error => { if (error) next(error); });
  });
  app.use(((error, _request, response, _next) => {
    if (response.headersSent) { response.end(); return; }
    const status = error?.status === 404 ? 404 : 500;
    response.status(status).set("Cache-Control", "no-store").json({ ok: false, error: status === 404 ? "Not found" : "Internal server error" });
  }) satisfies express.ErrorRequestHandler);
  return app;
}
