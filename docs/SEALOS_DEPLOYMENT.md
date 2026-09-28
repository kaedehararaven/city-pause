# Sealos single-container deployment

## Delivery

Merge the complete application and these deployment files into `main` before
publishing. The older `main` does not contain the full product. This change does
not merge, commit, push, publish an image or operate Sealos automatically.

The workflow `.github/workflows/container.yml` runs on pushes to `main`. It uses
GitHub's `GITHUB_TOKEN` with `packages: write`, not a personal access token.
The Docker build runs typechecks and mock tests before the production build.
Images are published as:

- `ghcr.io/kaedehararaven/city-pause:sha-<full Git commit SHA>`
- `ghcr.io/kaedehararaven/city-pause:latest`

Use the SHA tag or published digest in Sealos for reproducible deployment.
The workflow currently targets `linux/amd64`; select matching Sealos nodes.

## Configuration

In GitHub repository Settings -> Secrets and variables -> Actions, add the
repository secret `VITE_BAIDU_BROWSER_AK`. It is passed as a BuildKit secret only
to the Vite build. Browser AK is intentionally public in the generated JS.
Changing it requires rebuilding the image. Never add the server credential to
GitHub Actions or Docker build inputs.

Set the server credential only in Sealos runtime environment variables:

- `SERVER_AK`: the server-side Baidu credential.
- `PORT`: `3001` (optional; image default).

Use one fixed instance, container port 3001, public HTTPS ingress and a health
probe at `/api/health`. The image already starts the production server; no
custom command is needed. No persistent volume is required. The Node process
serves only `dist` as static files and dispatches `/api/*` to the existing API.
Memory caches, deduplication and place 302 cooldown survive while that process
survives; they are lost on restart and never shared between replicas. Existing
Vite local development, Makers and Vercel entries are unchanged.

GHCR packages may initially be private. For unauthenticated Sealos image pulls,
make this package public; otherwise configure registry pull credentials in
Sealos. Do not assume the workflow's temporary token can be reused for pulls.
Mainland domain/ICP/HTTPS and registry reachability depend on the selected
Sealos region; verify them in the console. Browser AK Referer rules must allow
the final hostname. Confirm Server AK outbound IP restrictions separately.

## Verification

Locally run `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`.
With Docker installed, build with a Browser AK environment variable:

```sh
docker build --secret id=browser_ak,env=VITE_BAIDU_BROWSER_AK -t city-pause:test .
docker run --rm -p 3001:3001 city-pause:test
```

Without a runtime server credential, health, static files and Demo still work;
valid provider requests return 503 without contacting Baidu. Before adding the
credential, verify `/`, `/?replay=1`, a non-API SPA path, `/api/health`, invalid
parameters (400), unknown API paths (JSON 404), and missing assets (404).
Verify the published image is present in GHCR before entering it in Sealos.
Actual image build/push/pull success requires a CI run; local Node tests alone
do not certify container packaging. Live Baidu testing requires authorization.

The runtime image contains production dependencies, `dist`, `server-dist` and
package metadata. Dotenv files, Git data, local caches and key files are excluded
by `.dockerignore`. The build verifier rejects server-key symbols/known values
and localhost API URLs in the frontend. Production starts without loading a
local dotenv file. API names mentioning server configuration in compiled backend
code are expected; no actual server credential is part of the image.
