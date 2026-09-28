import { readFile, writeFile } from "node:fs/promises";
import { replayData, replayInterStopEdges, replayOrigins, replayCapture } from "../src/demo/replayData";
import { replayMultiData } from "../src/demo/multiReplay";
import { restShowcase } from "../src/demo/restShowcase";
import { parseUserIntent } from "../src/recommendation/intent";
import { buildDecisionResult } from "../src/recommendation/engine";
import { buildMultiWithSupply } from "../src/route-builder/supplement";
import { fetchWalkingRoute } from "../src/map/capabilityClient";
import { edgeKey, sameEndpoint } from "../src/route-builder/edges";
import type { SuccessfulRouteResult } from "../src/contracts/map";

const output = new URL("../src/demo/public-map-capture.json", import.meta.url);
let record: { capturedAt: string; requests: number; routes: SuccessfulRouteResult[] };
try { record = JSON.parse(await readFile(output, "utf8")); }
catch { record = { capturedAt: "", requests: 0, routes: [] }; }
const acquire = process.argv.includes("--capture");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (!acquire || typeof input !== "string" || !input.startsWith("/api/map/walking-route?")) throw new Error("Outside capture scope");
  return nativeFetch(`http://127.0.0.1:5173${input}`, init);
};
const candidates = new Map<string, SuccessfulRouteResult>();
for (const minutes of [90,180]) for (const activity of ["rest","walk","explore"] as const) {
  const intent = parseUserIntent({minutes,activity,text:"",avoidCost:false,nearby:false});
  const singles = buildDecisionResult(intent,replayData(intent)).recommendations;
  const built = await buildMultiWithSupply({intent,singles,...replayMultiData(intent)});
  const shown = await restShowcase(built,intent,"compact");
  for (const route of shown.routes.flatMap(r=>r.edges)) candidates.set(edgeKey({from:route.from,to:route.to,destinationUid:route.to.id}),route);
}
let calls = 0;
for (const edge of candidates.values()) {
  if (record.routes.some(r=>sameEndpoint(r.from,edge.from)&&sameEndpoint(r.to,edge.to))) continue;
  if (!acquire || calls>=12) break;
  if (![...replayInterStopEdges,...replayCapture.routes].some(r=>sameEndpoint(r.from,edge.from)&&sameEndpoint(r.to,edge.to))) throw new Error("Non-historical edge");
  if (Object.values(replayOrigins).some(p=>sameEndpoint(p,edge.to))) throw new Error("Return edge outside scope");
  calls++; record.requests++;
  const route = await fetchWalkingRoute({from:edge.from,to:edge.to,destinationUid:edge.to.id});
  if (route.status==="success" && route.geometry?.length) record.routes.push(route);
  record.capturedAt=new Date().toISOString();
  await writeFile(output,JSON.stringify(record,null,2)+"\n");
  if (route.status!=="success" || !route.geometry?.length) { console.log("Geometry unavailable; stopped without guessing paths"); break; }
  await new Promise(resolve=>setTimeout(resolve,400));
}
console.log(JSON.stringify({calls,requiredEdges:candidates.size,savedGeometryEdges:record.routes.length,segments:record.routes.reduce((n,r)=>n+(r.geometry?.length??0),0)}));
