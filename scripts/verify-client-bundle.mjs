import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: ".env.local", quiet: true });

const clientOutput = "dist";
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg"]);
const forbiddenValues = ["SERVER_AK"];

if (process.env.SERVER_AK) {
  forbiddenValues.push(process.env.SERVER_AK);
}

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTextFiles(path);
      return textExtensions.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

for (const file of await collectTextFiles(clientOutput)) {
  const contents = await readFile(file, "utf8");
  if (forbiddenValues.some((value) => contents.includes(value))) {
    throw new Error(`Server-only configuration found in client output: ${file}`);
  }
}

console.log("Client bundle contains no server-only AK configuration.");
