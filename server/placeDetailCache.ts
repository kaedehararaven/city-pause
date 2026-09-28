import { BaiduProviderError } from "./baiduMapService.js";

// Process-local, short-lived cache. Failed responses are never cached as facts.
export class PlaceDetailBusyError extends Error {}

export function createPlaceDetailCache<T>(load: (uid: string) => Promise<T>, now = Date.now,
  pause = () => new Promise<void>(resolve => setTimeout(resolve, 400)),
  loadBatch?: (uids: string[]) => Promise<Map<string, T>>) {
  const cache = new Map<string, { data: T; observedAt: number; expiresAt: number }>();
  const pending = new Map<string, Promise<T & { observedAt: number; expiresAt: number }>>();
  let queue: Promise<unknown> = Promise.resolve();
  let blockedUntil = 0;
  let refusal: unknown;
  const get = (uid: string) => {
    const cached = cache.get(uid);
    if (cached && cached.expiresAt > now()) {
      cache.delete(uid);
      cache.set(uid, cached);
      return Promise.resolve({ ...cached.data, observedAt: cached.observedAt, expiresAt: cached.expiresAt });
    }
    cache.delete(uid);
    const active = pending.get(uid);
    if (active) return active;
    if (pending.size >= 32) return Promise.reject(new PlaceDetailBusyError("Place detail queue full"));
    const task = queue.then(async () => {
      if (now() < blockedUntil) throw refusal;
      await pause();
      const data = await load(uid);
      const observedAt = now();
      const expiresAt = observedAt + 5 * 60_000;
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(uid, { data, observedAt, expiresAt });
      return { ...data, observedAt, expiresAt };
    }).catch(error => {
      if (error instanceof BaiduProviderError && error.providerStatus === 302 && now() >= blockedUntil) {
        blockedUntil = now() + 60_000;
        refusal = error;
      }
      throw error;
    }).finally(() => pending.delete(uid));
    pending.set(uid, task);
    queue = task.catch(() => undefined);
    return task;
  };
  const batch = async (uids: string[]) => {
    const unique = [...new Set(uids)];
    if (!loadBatch) return Promise.allSettled(unique.map(get));
    const missing = unique.filter(uid => !pending.has(uid) && !(cache.get(uid)?.expiresAt! > now()));
    if (missing.length) {
      if (missing.length > 10 || pending.size + missing.length > 32) throw new PlaceDetailBusyError("Place detail queue full");
      const work = queue.then(async () => {
        if (now() < blockedUntil) throw refusal;
        await pause();
        const values = await loadBatch(missing);
        const observedAt = now(), expiresAt = observedAt + 5 * 60_000;
        for (const uid of missing) {
          const data = values.get(uid);
          if (data === undefined) continue;
          if (cache.size >= 256 && !cache.has(uid)) cache.delete(cache.keys().next().value!);
          cache.set(uid, { data, observedAt, expiresAt });
        }
        return values;
      }).catch(error => {
        if (error instanceof BaiduProviderError && error.providerStatus === 302 && now() >= blockedUntil) { blockedUntil = now() + 60_000; refusal = error; }
        throw error;
      });
      queue = work.catch(() => undefined);
      for (const uid of missing) {
        const task = work.then(() => { const item = cache.get(uid); if (!item) throw new Error("Detail missing from batch"); return { ...item.data, observedAt: item.observedAt, expiresAt: item.expiresAt }; }).finally(() => pending.delete(uid));
        pending.set(uid, task);
      }
    }
    return Promise.allSettled(unique.map(get));
  };
  return Object.assign(get, { batch });
}
