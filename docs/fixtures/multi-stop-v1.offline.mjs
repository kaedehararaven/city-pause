// DESIGN LAB ONLY. Synthetic coordinates, labels and route times; no Baidu data.
// Not imported by the application, Vite, or the production recommendation engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_IN_DESIGN_LAB'); };
const buffer = t => Math.max(3, Math.min(10, Math.round(t / 10)));
const families = {
  food: [30, 60], bookCafe: [30, 60], catCafe: [60, 120], green: [30, 60],
  culture: [40, 90], commercial: [25, 50], mall: [40, 90], interest: [15, 40],
  daily: [15, 40], experience: [40, 90], heritage: [50, 90],
};
const paths = {
  food: '美食 > 咖啡厅', bookCafe: '休闲娱乐 > 书咖', catCafe: '休闲娱乐 > 猫咖',
  green: '旅游景点 > 公园', culture: '文化传媒 > 展览馆', commercial: '购物 > 商业街',
  mall: '购物 > 购物中心', interest: '购物 > 商铺 > 书店', daily: '购物 > 便利店',
  experience: '休闲娱乐 > 手工制作', heritage: '旅游景点 > 人文景观 > 古村古镇',
};
const O = { id: 'mock-origin', source: 'mock', x: 0, y: 0 };
function poi(id, family, rank, x, y, match = 'S') {
  return { id, source: 'mock', family, rank, x, y, match, dwell: [...families[family]],
    classifiedTag: paths[family], coordinateSystem: 'SYNTHETIC_LOCAL_METERS',
    // Deliberately synthetic. Geometry uses the local-meter plane above.
    longitude: x / 111320, latitude: y / 111320, rating: 4.6, price: 30 };
}
const mixedFixture = [
  poi('park', 'green', 1, 200, 0), poi('book', 'interest', 2, 400, 0, 'W'),
  poi('cafe', 'food', 3, 600, 0, 'W'), poi('mall', 'mall', 4, 500, 120, 'M'),
  poi('gallery', 'culture', 5, 600, 150, 'M'), poi('street', 'commercial', 6, 700, 0),
  poi('craft', 'experience', 7, 800, 50, 'M'), poi('cat', 'catCafe', 8, 150, 100, 'W'),
];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function geometry(points) {
  const chain = points.slice(1).reduce((s, p, i) => s + distance(points[i], p), 0);
  if (chain === 0) return { chain, mst: 0, g: null, status: 'DEGENERATE' };
  const used = new Set([0]);
  let mst = 0;
  while (used.size < points.length) {
    let best = Infinity, next = -1;
    for (const i of used) for (let j = 0; j < points.length; j++) {
      if (!used.has(j) && distance(points[i], points[j]) < best) {
        best = distance(points[i], points[j]); next = j;
      }
    }
    mst += best; used.add(next);
  }
  return { chain, mst, g: mst / chain, status: 'KNOWN' };
}
function allocate(ranges, D) {
  const minimum = ranges.reduce((s, r) => s + r[0], 0);
  if (!Number.isFinite(D) || D < minimum) return null;
  const width = ranges.reduce((s, r) => s + r[1] - r[0], 0);
  const alpha = width === 0 ? 0 : Math.min(1, (D - minimum) / width);
  const dwell = ranges.map(([min, max]) => min + alpha * (max - min));
  const displayDwell = dwell.map((d, i) => Math.max(ranges[i][0], 5 * Math.floor(d / 5)));
  return { alpha, dwell, displayDwell, remaining: D - dwell.reduce((s, v) => s + v, 0) };
}
const key = (a, b) => `${a.id}->${b.id}`;
function oracle(entries, cached = [], budget = 6) {
  const table = new Map(entries), cache = new Map(cached), attempted = new Map();
  return {
    calls: [], hits: 0, budget,
    peek(a, b) { return cache.get(key(a, b)); },
    edge(a, b) {
      const k = key(a, b);
      if (cache.has(k)) { this.hits++; return { status: 'success', minutes: cache.get(k) }; }
      if (attempted.has(k)) return attempted.get(k);
      if (this.calls.length >= budget) return { status: 'budget_exhausted' };
      this.calls.push(k);
      const value = table.get(k);
      const result = typeof value === 'number' ? { status: 'success', minutes: value } : { status: value ?? 'provider_error' };
      attempted.set(k, result);
      if (result.status === 'success') cache.set(k, result.minutes);
      return result;
    },
  };
}
function maxStops(T, goal) { return T === 30 ? 1 : T <= 60 || goal === 'rest' ? 2 : 3; }
function cheapPartners(a, candidates, T, api) {
  // Unknown edge contributes zero, never a guessed walking speed.
  const oa = api.peek(O, a) ?? 0;
  return candidates.filter(b => b.id !== a.id && b.family !== a.family &&
    oa + (api.peek(a, b) ?? 0) <= .3 * T &&
    oa + (api.peek(a, b) ?? 0) + a.dwell[0] + b.dwell[0] + buffer(T) <= T);
}
function anchor(candidates, T, api) {
  const ranked = [...candidates].sort((a, b) => a.rank - b.rank);
  const checked = [];
  for (const a of ranked.slice(0, 2)) {
    checked.push(a.id);
    const partners = cheapPartners(a, ranked, T, api);
    if (partners.length) return { anchor: a, partners, checked };
  }
  return { anchor: null, partners: [], checked };
}
function verify(stops, T, api) {
  if (new Set(stops.map(p => p.family)).size !== stops.length) return null;
  const points = [O, ...stops];
  let travel = 0;
  const min = stops.reduce((s, p) => s + p.dwell[0], 0);
  for (let i = 1; i < points.length; i++) {
    if (travel + min + buffer(T) > T || travel > .3 * T) return null;
    const edge = api.edge(points[i - 1], points[i]);
    if (edge.status !== 'success') return null;
    travel += edge.minutes;
  }
  if (travel > .3 * T) return null;
  const allocation = allocate(stops.map(p => p.dwell), T - travel - buffer(T));
  if (!allocation) return null;
  return { id: stops.map(p => p.id).join('>'), stops, travel, geometry: geometry(points), ...allocation,
    total: travel + buffer(T) + allocation.dwell.reduce((s, d) => s + d, 0),
    displayTotal: travel + buffer(T) + allocation.displayDwell.reduce((s, d) => s + d, 0) };
}
function explore(candidates, T, goal, api) {
  if (maxStops(T, goal) < 2) return { status: 'NOT_APPLICABLE', routes: [], checked: [] };
  const selection = anchor(candidates, T, api);
  if (!selection.anchor) return { status: 'NO_FEASIBLE_MULTI_STOP_ROUTE', routes: [], checked: selection.checked };
  const a = selection.anchor, pairs = [], routes = [];
  const ordered = [...selection.partners].sort((b, c) => {
    return (geometry([O, a, c]).g ?? -1) - (geometry([O, a, b]).g ?? -1) || b.rank - c.rank;
  });
  for (const b of ordered.slice(0, 6)) {
    const r = verify([a, b], T, api);
    if (r) { pairs.push(r); routes.push(r); }
  }
  if (maxStops(T, goal) === 3) for (const pair of pairs.slice(0, 3)) {
    const b = pair.stops[1];
    const third = candidates.filter(c => !pair.stops.some(p => p.id === c.id || p.family === c.family) &&
      pair.travel + pair.stops.reduce((s, p) => s + p.dwell[0], 0) + c.dwell[0] + buffer(T) <= T)
      .sort((c, d) => (geometry([O, a, b, d]).g ?? -1) - (geometry([O, a, b, c]).g ?? -1) || c.rank - d.rank);
    for (const c of third.slice(0, 2)) { const r = verify([a, b, c], T, api); if (r) routes.push(r); }
  }
  // No post-API anchor fallback: selection happens exactly once.
  return { status: routes.length ? 'VERIFIED' : 'NO_VERIFIED_ROUTE', routes, checked: selection.checked };
}
const levels = { S: 3, M: 2, W: 1 };
function quality(r) {
  return { worst: Math.min(...r.stops.map(p => levels[p.match])),
    strong: r.stops.filter(p => p.match === 'S').length / r.stops.length };
}
function goalCompare(a, b) { const x = quality(a), y = quality(b); return y.worst - x.worst || y.strong - x.strong; }
function factsCompare(a, b) {
  const rating = r => r.stops.every(p => Number.isFinite(p.rating)) ? Math.min(...r.stops.map(p => p.rating)) : null;
  const price = r => r.stops.every(p => Number.isFinite(p.price)) ? r.stops.reduce((s, p) => s + p.price, 0) / r.stops.length : null;
  const ar = rating(a), br = rating(b);
  if (ar !== null && br !== null && !(ar > 4.5 && br > 4.5) && ar !== br) return br - ar;
  if ((ar === null) !== (br === null)) return ar === null ? 1 : -1;
  const ap = price(a), bp = price(b);
  if (ap !== null && bp !== null && ap !== bp) return ap - bp;
  if ((ap === null) !== (bp === null)) return ap === null ? 1 : -1;
  return a.id.localeCompare(b.id);
}
function rankProposed(routes) {
  // REVIEW CANDIDATE ONLY: fixed-reference mobility bands avoid pairwise cycles.
  const todo = [...routes].sort((a, b) => goalCompare(a, b) || a.travel - b.travel || a.id.localeCompare(b.id));
  const output = [];
  while (todo.length) {
    const first = todo[0], band = [];
    while (todo.length && goalCompare(first, todo[0]) === 0 &&
      (first.travel === 0 ? todo[0].travel === 0 : todo[0].travel < first.travel * 1.2)) band.push(todo.shift());
    band.sort((a, b) => (b.geometry.g ?? -1) - (a.geometry.g ?? -1) || factsCompare(a, b));
    output.push(...band);
  }
  return output;
}
function dedup(routes) {
  const kept = [];
  const subset = (a, b) => [...a].every(x => b.has(x));
  for (const r of routes) {
    const ids = new Set(r.stops.map(p => p.id)), fs = new Set(r.stops.slice(1).map(p => p.family));
    if (kept.some(k => {
      const kid = new Set(k.stops.map(p => p.id)), kfs = new Set(k.stops.slice(1).map(p => p.family));
      return subset(ids, kid) || subset(kid, ids) || subset(fs, kfs) || subset(kfs, fs);
    })) continue;
    kept.push(r); if (kept.length === 3) break;
  }
  return kept;
}

const results = [];
function test(name, fn) { const details = fn(); results.push({ name, passed: true, ...(details ? { details } : {}) }); }
const fileNames = ['engine.ts', 'goalCandidateSupply.ts', 'factors.ts', 'realProvider.ts'];
const digest = () => fileNames.map(f => createHash('sha256').update(readFileSync(new URL(`../../src/recommendation/${f}`, import.meta.url))).digest('hex'));
const before = digest();

test('A: 45min light two-stop', () => {
  const a = poi('book', 'interest', 1, 100, 0, 'M'), b = poi('shop', 'daily', 2, 200, 0, 'W');
  const api = oracle([[key(a, b), 3]], [[key(O, a), 3]]);
  const r = explore([a, b], 45, 'discover', api);
  assert.equal(r.routes.length, 1); assert.equal(r.routes[0].total, 45);
  assert.equal(api.calls.length, 1); return { total: r.routes[0].total, additionalEdges: api.calls.length };
});
test('B: culture plus retail at 60min is impossible before route requests', () => {
  const a = poi('art', 'culture', 1, 1, 0), b = poi('book', 'interest', 2, 2, 0, 'M');
  const api = oracle([]); assert.equal(explore([a, b], 60, 'discover', api).routes.length, 0);
  assert.equal(api.calls.length, 0); assert.equal(40 + 15 + buffer(60), 61);
});
test('C: 90min S+S two-stop beats feasible S+M+M three-stop', () => {
  const a = poi('park', 'green', 1, 100, 0), b = poi('street', 'commercial', 2, 200, 0);
  const c = poi('book', 'interest', 3, 300, 0, 'M'), d = poi('shop', 'daily', 4, 400, 0, 'M');
  const api = oracle([], [[key(O, a), 2], [key(a, b), 2], [key(a, c), 4], [key(c, d), 4]]);
  const two = verify([a, b], 90, api), three = verify([a, c, d], 90, api);
  assert.ok(two && three); assert.equal(rankProposed([three, two])[0], two);
  return { winnerStops: two.stops.length, threeAlsoFeasible: true };
});
test('D: 120/150min third stop admitted without erasing two-stop', () => {
  const [a, b, c] = mixedFixture;
  for (const T of [120, 150]) {
    const api = oracle([[key(a, b), 3], [key(a, c), 5], [key(b, c), 3], [key(c, b), 3]], [[key(O, a), 4]], 12);
    const r = explore([a, b, c], T, 'walk', api);
    assert.ok(r.routes.some(x => x.stops.length === 2)); assert.ok(r.routes.some(x => x.stops.length === 3));
    for (const route of r.routes) assert.ok(route.dwell.every((d, i) => d >= route.stops[i].dwell[0]));
  }
});
test('E: cat cafe minimum remains 60', () => {
  const a = poi('cat', 'catCafe', 1, 10, 0, 'M'), b = poi('book', 'interest', 2, 20, 0, 'M');
  for (const T of [60, 90]) {
    const api = oracle([[key(a, b), 2]], [[key(O, a), 2]]);
    const r = explore([a, b], T, 'rest', api);
    assert.equal(r.routes.length, T === 60 ? 0 : 1);
    if (T === 90) assert.ok(r.routes[0].dwell[0] >= 60);
  }
});
test('F: same-family pool exits with zero route calls', () => {
  const api = oracle([]);
  const r = explore([poi('art1', 'culture', 1, 100, 0), poi('art2', 'culture', 2, 200, 0)], 180, 'discover', api);
  assert.equal(r.status, 'NO_FEASIBLE_MULTI_STOP_ROUTE'); assert.equal(api.calls.length, 0);
});
test('G: only free infeasibility permits anchor #2', () => {
  const a = poi('art', 'culture', 1, 100, 0), b = poi('book', 'interest', 2, 200, 0, 'M'), c = poi('park', 'green', 3, 300, 0, 'W');
  const api = oracle([[key(b, c), 3]], [[key(O, a), 0], [key(O, b), 5]]);
  const r = explore([a, b, c], 60, 'discover', api);
  assert.deepEqual(r.checked, ['art', 'book']); assert.equal(r.routes[0].stops[0].id, 'book');
  assert.deepEqual(api.calls, [key(b, c)]);
});
test('H: geometry samples and zero-distance degeneracy', () => {
  const p = (x, y) => ({ x, y });
  const samples = {
    forward: geometry([p(0, 0), p(100, 0), p(200, 0), p(300, 0)]),
    mild: geometry([p(0, 0), p(100, 0), p(80, 30), p(200, 30)]),
    backtrack: geometry([p(0, 0), p(100, 0), p(-100, 0), p(200, 0)]),
    same: geometry([p(0, 0), p(0, 0), p(0, 0)]),
  };
  assert.equal(samples.forward.g, 1); assert.ok(samples.mild.g < 1 && samples.mild.g > .5);
  assert.equal(samples.backtrack.g, .5); assert.equal(samples.same.g, null);
  return Object.fromEntries(Object.entries(samples).map(([name, v]) => [name, v.g]));
});
test('I: excess budget remains after all max values', () => {
  const a = poi('book', 'interest', 1, 100, 0, 'M'), b = poi('shop', 'daily', 2, 200, 0, 'W');
  const r = verify([a, b], 180, oracle([], [[key(O, a), 2], [key(a, b), 2]]));
  assert.deepEqual(r.dwell, [40, 40]); assert.equal(r.total, 94); assert.equal(r.remaining, 86);
});
test('J: proportional expansion agrees with hand calculation', () => {
  const r = allocate([[30, 60], [15, 40]], 65);
  assert.ok(Math.abs(r.alpha - 20 / 55) < 1e-12);
  assert.ok(Math.abs(r.dwell[0] - 450 / 11) < 1e-12);
  assert.ok(Math.abs(r.dwell[1] - 265 / 11) < 1e-12);
  assert.deepEqual(r.displayDwell, [40, 20]);
  return { alpha: r.alpha, exact: r.dwell, display: r.displayDwell, displayReleasedMinutes: 5 };
});
test('API failures do not unlock anchor #2', () => {
  const a = poi('a', 'green', 1, 100, 0), b = poi('b', 'interest', 2, 200, 0, 'W'), c = poi('c', 'food', 3, 300, 0, 'W');
  const api = oracle([[key(a, b), 'provider_error'], [key(a, c), 'timeout'], [key(b, c), 1]], [[key(O, a), 1]], 6);
  const r = explore([a, b, c], 120, 'rest', api);
  assert.equal(r.routes.length, 0); assert.deepEqual(r.checked, ['a']); assert.equal(api.calls.length, 2);
  assert.ok(!api.calls.includes(key(b, c)));
});
test('partial cache, partial failure and directional identity', () => {
  const [a, b, c] = mixedFixture;
  const api = oracle([[key(a, c), 'timeout']], [[key(O, a), 2], [key(a, b), 2]], 6);
  const r = explore([a, b, c], 120, 'rest', api);
  assert.equal(r.routes.length, 1); assert.equal(api.calls.length, 1);
  assert.equal(api.peek(b, a), undefined); assert.ok(api.hits >= 2);
});
test('geometrically close does not override long real walking fixture', () => {
  const a = poi('a', 'green', 1, 100, 0), b = poi('b', 'interest', 2, 101, 0, 'W');
  const api = oracle([[key(a, b), 50]], [[key(O, a), 2]]);
  assert.equal(geometry([O, a, b]).g, 1); assert.equal(explore([a, b], 90, 'walk', api).routes.length, 0);
  assert.equal(api.calls.length, 1);
});
test('30min bypass and maxStops policies', () => {
  const api = oracle([]); assert.equal(explore(mixedFixture, 30, 'walk', api).status, 'NOT_APPLICABLE');
  assert.equal(api.calls.length, 0);
  assert.equal(maxStops(180, 'rest'), 2); assert.equal(maxStops(60, 'walk'), 2); assert.equal(maxStops(90, 'discover'), 3);
});
test('6 vs 12 edge budget on identical synthetic pool', () => {
  const a = poi('anchor', 'green', 1, 100, 0);
  const rest = ['interest', 'daily', 'commercial', 'food', 'bookCafe', 'culture'].map((f, i) => poi(`p${i}`, f, i + 2, 200 + i * 100, 0, 'M'));
  const entries = rest.map(b => [key(a, b), 2]);
  for (const b of rest) for (const c of rest) if (b !== c) entries.push([key(b, c), 2]);
  const summary = [];
  for (const budget of [6, 12]) {
    const api = oracle(entries, [[key(O, a), 2]], budget);
    const r = explore([a, ...rest], 180, 'walk', api);
    assert.equal(api.calls.length, budget); assert.equal(new Set(api.calls).size, api.calls.length);
    const triples = r.routes.filter(x => x.stops.length === 3).length;
    assert.equal(triples, budget === 6 ? 0 : 6);
    summary.push({ budget, calls: api.calls.length, verifiedDrafts: r.routes.length, triples, afterDedup: dedup(rankProposed(r.routes)).length });
  }
  return summary;
});
test('route dedup removes reversed and extended copies without stop bonus', () => {
  const [a, b, c] = mixedFixture;
  const api = oracle([], [[key(O, a), 2], [key(a, b), 2], [key(b, c), 2], [key(O, b), 2], [key(b, a), 2]]);
  const two = verify([a, b], 150, api), reverse = verify([b, a], 150, api), three = verify([a, b, c], 150, api);
  assert.equal(dedup([two, reverse, three]).length, 1);
});
test('pairwise 20 percent mobility rule can cycle', () => {
  const x = { t: 10, g: .8 }, y = { t: 11.5, g: .9 }, z = { t: 13, g: 1 };
  const cmp = (a, b) => Math.abs(a.t - b.t) / Math.min(a.t, b.t) >= .2 ? a.t - b.t : b.g - a.g;
  assert.ok(cmp(y, x) < 0 && cmp(z, y) < 0 && cmp(x, z) < 0);
  return 'Y beats X, Z beats Y, X beats Z';
});
test('dwell bounds, safe display, saturation, fixed-route budget monotonicity', () => {
  let cases = 0;
  const ranges = Object.values(families);
  for (const a of ranges) for (const b of ranges) for (const c of [null, ...ranges]) {
    const rs = c ? [a, b, c] : [a, b]; let previous = null;
    for (const T of [30, 45, 60, 90, 120, 150, 180]) {
      const r = allocate(rs, T - buffer(T) - 4);
      if (!r) continue;
      r.dwell.forEach((d, i) => {
        assert.ok(d >= rs[i][0] && d <= rs[i][1]);
        assert.ok(r.displayDwell[i] >= rs[i][0] && r.displayDwell[i] <= d);
        if (previous) assert.ok(d >= previous[i] - 1e-10);
      });
      assert.ok(4 + buffer(T) + r.dwell.reduce((s, d) => s + d, 0) <= T + 1e-9);
      assert.ok(4 + buffer(T) + r.displayDwell.reduce((s, d) => s + d, 0) <= T);
      previous = r.dwell; cases++;
    }
  }
  assert.deepEqual(allocate([[5, 5], [10, 10]], 20).dwell, [5, 10]);
  return { allocationsChecked: cases };
});
test('MST ratio bounds over deterministic synthetic grids', () => {
  let count = 0;
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) {
    const r = geometry([O, { x: x * 100, y: 0 }, { x: 0, y: y * 100 }, { x: z * 100, y: z * 100 }]);
    assert.ok(r.g === null || r.g > 0 && r.g <= 1 + 1e-12); count++;
  }
  return { geometriesChecked: count };
});
test('no stop-count quality bonus and tight triple does not get priority by length', () => {
  const s = poi('s', 'green', 1, 1, 0), m = poi('m', 'interest', 2, 2, 0, 'M');
  assert.equal(goalCompare({ stops: [s, s] }, { stops: [s, s, s] }), 0);
  assert.ok(goalCompare({ stops: [s, s] }, { stops: [s, m, m] }) < 0);
  assert.ok(goalCompare({ stops: [s, s, s] }, { stops: [s, m] }) < 0);
});
test('single-place source and caller-owned candidates unchanged', () => {
  const original = JSON.stringify(mixedFixture);
  explore(mixedFixture, 120, 'walk', oracle([], [[key(O, mixedFixture[0]), 3]], 6));
  assert.equal(JSON.stringify(mixedFixture), original); assert.deepEqual(digest(), before);
});

test('same Family can never pass verify, even with zero travel', () => {
  const a = poi('a', 'culture', 1, 0, 0), b = poi('b', 'culture', 2, 0, 0);
  const api = oracle([], [[key(O, a), 0], [key(a, b), 0]]);
  assert.equal(verify([a, b], 180, api), null); assert.equal(api.calls.length, 0);
});
test('three-stop can win through coherence, not count', () => {
  const [a, b, c] = mixedFixture;
  const two = { id: 'two', stops: [{ ...a, match: 'S' }, { ...b, match: 'S' }], travel: 10, geometry: { g: .8 } };
  const three = { id: 'three', stops: [{ ...a, match: 'S' }, { ...b, match: 'S' }, { ...c, match: 'S' }], travel: 11, geometry: { g: 1 } };
  assert.equal(rankProposed([two, three])[0], three);
  three.geometry.g = .7; assert.equal(rankProposed([two, three])[0], two);
});
test('rating/price aggregation proposal preserves high-rating and UNKNOWN distinctions', () => {
  const base = poi('p', 'interest', 1, 0, 0);
  const a = { id: 'a', stops: [{ ...base, rating: 4.9, price: 100 }] };
  const b = { id: 'b', stops: [{ ...base, rating: 4.8, price: 20 }] };
  assert.ok(factsCompare(b, a) < 0);
  const unknown = { id: 'u', stops: [{ ...base, rating: undefined, price: undefined }] };
  assert.ok(factsCompare(a, unknown) < 0);
});
test('same input ordering yields deterministic ranking without comparator cycles', () => {
  const p = poi('p', 'interest', 1, 0, 0);
  const routes = [10, 11.5, 13].map((travel, i) => ({ id: String(i), stops: [p, { ...p, family: 'daily' }], travel, geometry: { g: .8 + i / 10 } }));
  const expected = rankProposed(routes).map(r => r.id);
  assert.deepEqual(rankProposed([...routes].reverse()).map(r => r.id), expected);
  assert.deepEqual(rankProposed([routes[1], routes[2], routes[0]]).map(r => r.id), expected);
});
test('free fallback stops at #2 even when #3 could build a route', () => {
  const candidates = [poi('art1', 'culture', 1, 100, 0), poi('art2', 'culture', 2, 200, 0),
    poi('book', 'interest', 3, 300, 0, 'M'), poi('shop', 'daily', 4, 400, 0, 'W')];
  const api = oracle([[key(candidates[2], candidates[3]), 1]], [[key(O, candidates[2]), 1]]);
  const r = explore(candidates, 60, 'discover', api);
  assert.deepEqual(r.checked, ['art1', 'art2']); assert.equal(r.routes.length, 0); assert.equal(api.calls.length, 0);
});
test('low G remains a soft signal, not a rejection threshold', () => {
  const a = poi('a', 'green', 1, 100, 0), b = poi('b', 'interest', 2, -100, 0, 'W');
  const r = verify([a, b], 120, oracle([], [[key(O, a), 2], [key(a, b), 2]]));
  assert.ok(r && r.geometry.g < .7);
});
test('no_route has no post-validation anchor fallback either', () => {
  const a = poi('a', 'green', 1, 100, 0), b = poi('b', 'interest', 2, 200, 0, 'W');
  const api = oracle([[key(a, b), 'no_route']], [[key(O, a), 2]]);
  const r = explore([a, b], 90, 'walk', api);
  assert.deepEqual(r.checked, ['a']); assert.equal(r.routes.length, 0); assert.equal(api.calls.length, 1);
});
test('all cached edges require no new requests even with zero remaining budget', () => {
  const [a, b, c] = mixedFixture;
  const api = oracle([], [[key(O, a), 2], [key(a, b), 2], [key(b, c), 2]], 0);
  assert.ok(verify([a, b, c], 120, api)); assert.equal(api.calls.length, 0);
});

console.log(JSON.stringify({ source: 'PURE_SYNTHETIC_DESIGN_LAB', formalIntegration: false,
  networkCalls: 0, passed: results.length, fixture: mixedFixture, results }, null, 2));
