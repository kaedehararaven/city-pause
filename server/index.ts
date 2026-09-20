import { createAppServer } from "./app.js";
import { serverConfig } from "./config.js";

const server = createAppServer();

server.listen(serverConfig.port, "127.0.0.1", () => {
  console.log(`Backend listening on http://127.0.0.1:${serverConfig.port}`);
});
