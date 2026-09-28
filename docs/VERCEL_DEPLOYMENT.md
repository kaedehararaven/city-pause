# Vercel deployment

Vite serves `dist`; `api/[...path].ts` is a Node catch-all function for the
existing `/api/*` URLs. It imports the shared handler once per warm instance,
does not listen on a port and reads `SERVER_AK` only on the server. Makers and
local Node entries remain supported. Recommendation and provider code are
unchanged.

## Console

- Repository: `kaedehararaven/city-pause`, production branch `codex/a3-algorithm`.
- Preset: Vite; root: `./`; output: `dist`; Node: 24.x.
- `vercel.json` pins installation and build commands. Do not override the build
  with `vite build`, which would bypass server typechecks and the secret scan.
- Configure `VITE_BAIDU_BROWSER_AK` at build time and `SERVER_AK` for the function
  runtime. Select the appropriate Production/Preview scopes. Never use a public
  prefix for the server key. Redeploy after changing environment variables.
- No SPA rewrite is needed for current query-string routes (`/?replay=1`).
  Do not introduce a catch-all HTML rewrite that could swallow `/api/*`.
- Allow the final HTTPS hostname in Baidu Browser AK Referer settings. Verify
  any Server AK outbound IP restrictions; serverless egress is not assumed fixed.

## Checks

Run `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`.
After publishing, confirm the deployment lists the API function and that
`/api/health` returns JSON 200, all five map endpoints reject missing parameters
with JSON 400, and unknown API paths return JSON 404. These checks consume no
Baidu quota. Demo generation must not trigger search or route calls. Test one
real recommendation only when authorized. A local Node test does not prove
Vercel's routing or bundle packaging; verify these in the first preview build.

Memory caches, pending-request deduplication and the place 302 cooldown remain
instance-local, not durable or globally shared. The 30-second function limit
does not change the client's 12-second timeout or upstream 10-second timeout.
The API has no per-user quota; configure suitable platform access/rate controls
before broad public exposure. Check actual mainland network access before
sharing a Vercel domain with judges.

No deployment, commit/push or live Baidu requests are performed by adding this
entry. Keep `.env.local` out of Git and static artifacts.
