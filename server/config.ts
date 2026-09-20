import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: ".env.local", quiet: true });

export const serverConfig = {
  port: Number.parseInt(process.env.PORT ?? "3001", 10),
} as const;

export function getServerAk(): string | undefined {
  return process.env.SERVER_AK;
}
