import { createMakersApp } from "../../server/makersApp.js";

// Makers framework entry: no listen(), no browser imports or local .env files.
export default createMakersApp({ serverAk: process.env.SERVER_AK });
