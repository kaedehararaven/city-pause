# EdgeOne Makers deployment

## Architecture

```text
Browser -> Makers static hosting (dist)
Browser -> /api/* -> cloud-functions/api/[[default]].ts
        -> Express transport -> shared server/app.ts handler
        -> existing Baidu adapter -> Baidu Web API
Browser -> Baidu JSAPI (public Browser AK)
```

The function exports an Express app without listening on a port. The handler
and its caches are created once per function instance. Both full `/api/...`
URLs and platform-relative URLs are accepted by the transport. The local
`server/index.ts` still starts the same handler on localhost:3001.

No recommendation rules, supply rules, Baidu parameters, cache policies or
frontend API URLs change. This is a transport adaptation, not a quota upgrade.

## Console settings

- Repository: `kaedehararaven/city-pause`; select the intended commit from
  `codex/a3-algorithm`, not the older default branch by accident.
- Framework: Vite. Root: `./`. Output: `dist`.
- Build: `npm run build`. Installation and build Node version are pinned in
  `edgeone.json`. Build Node 24 is separate from the platform's Node 20 cloud
  function runtime; server dependencies and APIs must support both.
- Configure `VITE_BAIDU_BROWSER_AK` for the frontend build.
- Configure `SERVER_AK` for the server runtime (Express reads `process.env`).
  Never prefix it with `VITE_`, include it in static files or expose it in logs.
- Do not upload `.env.local`, `node_modules` or the workspace as static assets.
- Select the cloud function region in the console. Do not assume a fixed
  outbound IP. Check any Server AK IP restrictions before live testing.
- Cloud Functions are configured for a 30-second maximum execution time.
  The client timeout remains 12 seconds and Baidu timeout remains 10 seconds;
  queued requests can still time out. Raising the function limit alone is not
  a fix for this behavior.

## Domain and access

Use HTTPS and allow the final hostname in the Baidu Browser AK Referer rules.
Allow preview hostnames only if they will be used for tests. Do not allow all
domains just to bypass a configuration failure.

The official domain guide currently states that mainland access to default
project/deployment domains requires a preview URL valid for three hours.
For a stable judging URL, use a custom domain and configure HTTPS. Mainland
acceleration requires ICP filing; the global-excluding-mainland region does
not. Verify the policy shown in your own Makers console before distributing
the URL. No domain purchase or account setup is performed by this change.

## Verification before publishing

1. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`.
2. Confirm the Makers build detects `cloud-functions/api/[[default]].ts` as a
   Node function, not a static artifact. Current Node documentation uses
   `cloud-functions/`; older framework examples still say `node-functions/`.
   Do not ship two duplicate directories. A real preview build is the final
   platform compatibility check.
3. Confirm only `dist` is public, not `server-dist` or server source.
4. Confirm the production branch, both environment variables and domain rules.
5. Commit/push and trigger deployment only after explicit authorization.

## Smoke tests (start without Baidu requests)

- `/` and the Demo lazy chunk load; refreshing `/?replay=1` works.
- `/api/health` returns 200 JSON `{ "ok": true }`, not HTML.
- All five `/api/map/*` endpoints return 400 when required parameters are
  absent. This must not consume Baidu quota.
- Unknown API routes return JSON 404, not the SPA document.
- Historical Demo recommendation, sorting and expansion issue no search or
  route requests; maps/tiles and external navigation still require network.
- Inspect the deployed client assets and responses for Server AK leakage
  without printing the value. Run the bundle verifier during the build.
- After separate authorization, perform one live recommendation; inspect
  location, candidate tags, route data and the platform's sanitized logs.

## Remaining production limitations

Search/detail/route caches and concurrent deduplication are instance-local.
Search/detail 302 cooldown is also instance-local; route requests have no
equivalent cooldown. Cold starts and multiple instances can increase provider
usage. Existing browser caches and offline replay remain intact. No durable
shared store, global rate limit or per-user quota is introduced here. Configure
platform access/rate controls before opening the API broadly; domain Referer
rules are not a substitute for protecting the server proxy.

## Official references

- https://pages.edgeone.ai/document/node-functions
- https://pages.edgeone.ai/document/framework-backends
- https://pages.edgeone.ai/document/edgeone-json
- https://pages.edgeone.ai/document/build-guide
- https://pages.edgeone.ai/document/domain-overview
