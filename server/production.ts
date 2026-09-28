import { createProductionApp } from "./productionApp.js";

const port = Number(process.env.PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
// Production credentials come exclusively from the container environment.
const server = createProductionApp({ serverAk: process.env.SERVER_AK }).listen(port, "0.0.0.0", () => {
  console.log(`Production server listening on port ${port}`);
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
