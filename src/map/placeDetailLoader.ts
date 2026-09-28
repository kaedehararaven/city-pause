import type { MapPOI } from "../contracts/map";
import { detailFailure, fetchPlaceDetail, type TemporaryPlaceDetail } from "./capabilityClient";

const cache = new Map<string, { expires: number; detail: TemporaryPlaceDetail }>();
const pending = new Map<string, Promise<TemporaryPlaceDetail>>();
let queue: Promise<unknown> = Promise.resolve();

export function loadPlaceDetails(poi: MapPOI): Promise<TemporaryPlaceDetail> {
  if (poi.source !== "real" || poi.provider !== "baidu") return Promise.reject(new Error("仅支持真实百度地点"));
  const key = JSON.stringify([poi.provider, poi.providerId]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached.detail);
  }
  if (cached) cache.delete(key);
  const existing = pending.get(key);
  if (existing) return existing;
  const task = queue.then(async () => {
    let detail: TemporaryPlaceDetail;
    try { detail = await fetchPlaceDetail(poi.providerId); }
    catch (error) {
      if (!["network_unavailable", "timeout", "http_504"].includes(detailFailure(error).code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 400));
      detail = await fetchPlaceDetail(poi.providerId);
    }
    if (detail.providerId !== poi.providerId) throw new Error("地点详情不匹配");
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(key, { detail, expires: Math.min(detail.expiresAt ?? Infinity, Date.now() + 5 * 60_000) });
    return detail;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  queue = task.catch(() => undefined);
  return task;
}
