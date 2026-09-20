import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createAppServer } from "./app.js";

const activeServers: ReturnType<typeof createAppServer>[] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("GET /api/health", () => {
  it("returns the backend health status", async () => {
    const server = createAppServer();
    activeServers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
