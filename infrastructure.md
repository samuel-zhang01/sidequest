# SideQuest infrastructure contract

This document is the operating contract for SideQuest. It is deliberately
small: every interface, API, preview, and deploy must preserve this contract
unless the project owner explicitly changes it.

## Fixed addresses and one-port rule

| Purpose | Fixed value |
| --- | --- |
| Server LAN address | `192.168.1.3` |
| **Only host-published application port** | **`6969`** |
| Public application URL | `https://genesis.hiddenlayers.co.uk` |
| Cloudflare public HTTPS port | `443` (Cloudflare-managed; not a server application port) |
| Tunnel connector / edge host | `192.168.1.200` |
| Origin behind the Cloudflare Tunnel | `http://192.168.1.3:6969` |

The host must never publish a second application port.  In particular, do not
publish database ports, backend ports, Vite/Next development ports, debug
ports, or a second reverse-proxy port.  `6969` is the only port that may appear
in a Compose `ports:` mapping or a host-bound development command.

The public URL remains the HTTPS URL above. Every app must be usable at that
HTTPS URL; users and judges should **not** be asked to append `:6969`.
Cloudflare accepts their HTTPS connection on 443 and the tunnel forwards it
privately to the controller's port 6969.

## Intended topology

```text
Browser ── HTTPS :443 ── Cloudflare cache / edge ── Tunnel on 192.168.1.200
                                                        │
                                                        ▼
                                           http://192.168.1.3:6969
                                                        │
                                                        ▼
                                            web / gateway container
                                                ├── browser UI
                                                └── private API service(s)
                                                    └── persistence / integrations
                                                       (Compose network only)
```

Cloudflare terminates public TLS and owns the externally visible certificate.
The origin service on port 6969 is plain HTTP when using a Cloudflare Tunnel.
This is intentional: do not add a second host TLS proxy or a Let's Encrypt
certificate at that port. The engine tunnel's service target must be
`http://192.168.1.3:6969`, never `https://192.168.1.3:6969`.

## Required full-stack application contract

Every app deployed through this infrastructure must include all of the
following:

1. A responsive browser UI served by the web/gateway service.
2. Application-owned, same-origin `/api/...` endpoint(s) that the UI uses for
   the product's real behavior.
3. A private backend service that implements that behavior; it must not be
   simulated solely in browser JavaScript.
4. Server-side persistence or a documented server-side integration whenever the
   feature has state, user data, scores, submissions, or generated artifacts.
5. A `/health` endpoint, an `/api/status` endpoint, and a meaningful UI
   loading/failure state.

Do not ship a static HTML-only page as a new app. A frontend may be visually
simple, but the delivered product flow must cross the browser → gateway → API
boundary and keep secrets and internal services off the public network.

## Development and deployment workflow

Use npm as the developer entry point.  Future application work must provide at
least these scripts:

```json
{
  "scripts": {
    "dev": "docker compose up",
    "build": "docker compose pull && docker compose config --quiet",
    "start": "docker compose up -d",
    "down": "docker compose down"
  }
}
```

The exact framework command may vary, but the external behaviour may not:

* `npm run dev` makes the app reachable at `http://192.168.1.3:6969` for LAN
  development and, once the tunnel is healthy, at the required public HTTPS
  URL `https://genesis.hiddenlayers.co.uk`.
* `npm run build` pulls current runtime images and validates the Compose
  configuration without opening a new host port.  When a fixed production
  image build is added, it must preserve the same single-port contract.
* `npm run start` runs the production stack with exactly the same public
  ingress: host port `6969`.

Docker Compose is the preferred common runtime so development and deployment
use the same service graph.  Only the web/gateway service is allowed to expose
a host port, for example:

```yaml
services:
  web:
    # In production this may serve built static files and proxy /api.
    ports:
      - "6969:80"

  api:
    # No `ports:` entry.  Reachable only as http://api:<container-port>.
    expose:
      - "8080"
```

The demo binds `6969` on all host interfaces to permit deliberate LAN testing
at `http://192.168.1.3:6969`. The Cloudflare Tunnel on the engine targets
`http://192.168.1.3:6969`. Firewall policy may restrict the LAN source range,
but do not use a second mapping or run a second local server on this port.

For a simple one-process prototype without Compose, `npm run dev` may bind the
application directly to `0.0.0.0:6969`.  That is the only exception to the
Compose recommendation; it must be replaced by the same single ingress layout
before production deployment.

## Frontend, backend, and browser API rules

* Every product UI calls same-origin paths such as `/api/transcribe` and
  `/api/design-system`; it never calls a backend LAN address or container port.
  Browser-only stand-ins for required backend behavior are prohibited.
* The web/gateway proxies those paths to Docker services by service name, e.g.
  `http://api:8080`.  These ports stay internal to the Compose network.
* WebSockets, SSE, and upload endpoints are also proxied through the web
  service.  Never expose a framework HMR or API port to solve this.
* Put runtime secrets in deployment environment variables/secrets, never in
  frontend bundles or this document.
* Cloudflare caching may cache versioned static assets.  Dynamic API routes,
  authenticated routes, and HTML that must update immediately should send
  `Cache-Control: no-store` (or an explicit, intentional policy).

## Cloudflare Tunnel requirements

The Cloudflare dashboard/tunnel configuration must contain a public hostname
rule equivalent to:

```yaml
hostname: genesis.hiddenlayers.co.uk
service: http://192.168.1.3:6969
```

Run `cloudflared` as a managed service or a dedicated Compose service with
restart enabled.  It must have no dependency on a developer's terminal.
The tunnel credential/token belongs in the deployment secret store, not in the
repository.  Enable Cloudflare's normal HTTPS/edge caching policy there; this
repository does not manage the Cloudflare account.

## Remote engine access

The existing engine host is available on the LAN and has been verified from
this controller using SSH key authentication:

| Setting | Value |
| --- | --- |
| Engine host | `192.168.1.200` |
| SSH port | `22` |
| Deploy user | `whisperflow-deploy` |
| Pinned ED25519 host-key fingerprint | `SHA256:5FXWI0b6pzydnZycyyiJpXuImi5uA3sZcvT+sXloepg` |

The engine runs Docker and is the intended place for its existing web/edge
services; do not add another local Nginx configuration to this controller
without an explicit architecture change.

Before connecting, confirm the scanned ED25519 key matches the pinned
fingerprint above, then save it as the SSH known-hosts entry:

```bash
mkdir -p .secrets && chmod 700 .secrets
ssh-keyscan -T 5 -t ed25519 192.168.1.200 \
  | tee .secrets/engine-known_hosts \
  | ssh-keygen -lf - -E sha256
# Expected: SHA256:5FXWI0b6pzydnZycyyiJpXuImi5uA3sZcvT+sXloepg
chmod 600 .secrets/engine-known_hosts

ssh -i .secrets/whisperflow-engine_ed25519 \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=.secrets/engine-known_hosts \
  whisperflow-deploy@192.168.1.200 'hostname; uptime; systemctl is-active docker'
```

The private Ed25519 key is stored only at
`.secrets/whisperflow-engine_ed25519`, which is Git-ignored.  Never commit,
copy into documentation, or expose that key.  The public host fingerprint
above is safe to retain in this repository.

## Ansible deployment invariants

Ansible should be idempotent and perform these actions in this order:

1. Install or update the application source/images and secret environment.
2. Run `npm run build` (or the equivalent Compose build) and start the
   production profile.
3. Ensure the tunnel service is enabled and running.
4. Wait for `http://192.168.1.3:6969/health` to return success from the engine
   and for `http://127.0.0.1:6969/health` to return success on the controller.
5. Verify `https://genesis.hiddenlayers.co.uk` returns a non-5xx response.

The playbook must not open additional web ports, expose internal Docker
services, overwrite Cloudflare tunnel credentials, or use ephemeral dev
servers as the deployed process.

## Required pre-handoff checks

Run these after every infrastructure or deploy change:

```bash
# Exactly one local listener must own the ingress port.
ss -ltnp '( sport = :6969 )'

# The origin must respond locally.
curl -fsS http://127.0.0.1:6969/health

# This confirms the public Cloudflare route, TLS, and tunnel.
curl -fsSI --max-time 20 https://genesis.hiddenlayers.co.uk/
```

Expected public result: a successful HTTPS response (normally `200`, `301`,
or `304`), never `52x`. A Cloudflare `502` usually means the tunnel cannot
reach its target; first verify the engine can fetch
`http://192.168.1.3:6969/health`. A Cloudflare `525` means the origin was
incorrectly configured for TLS. For this design, the public hostname must point
to a running tunnel whose service target is the plain-HTTP
`http://192.168.1.3:6969`, not an HTTPS origin. This remains true even though
the browser-facing URL is HTTPS: Cloudflare terminates that TLS connection.

## Current verification — 2026-08-29

* Confirmed: this host owns `192.168.1.3`.
* Confirmed: authoritative DNS resolves `genesis.hiddenlayers.co.uk` to
  Cloudflare edge addresses.
* Demo running: `docker-compose.yml` starts the SideQuest Loop web gateway on
  `6969`, a private Node API, and private Postgres. The API privately imports
  aggregate Strava runs, accepts live GPS samples, and persists the complete
  feedback loop. The engine can fetch
  `http://192.168.1.3:6969/health` successfully. In this LXC environment its three
  containers use Docker's scoped `apparmor=unconfined` compatibility option;
  AppArmor is not disabled globally.
* Confirmed: `https://genesis.hiddenlayers.co.uk/` returns `HTTP 200` over
  public HTTPS. The working connector target is
  `http://192.168.1.3:6969`.
* Confirmed: the public `/live` page and authenticated `wss://` upgrade work
  through Cloudflare. A browser-level test relayed actual MediaRecorder camera
  output to an automatically joined viewer and buffered it through MediaSource.
* Confirmed: the private API receives the configured Gemini credential, and a
  real Agent Godoy request persisted Zod-validated structured output from
  `gemini-3.6-flash`. The credential value was not exposed during verification.
* Observed: no active `cloudflared` process or `cloudflared.service` is present
  on the controller or engine. The active connector is therefore elsewhere and
  must use the engine-to-controller HTTP target above.

The local full-stack app and public HTTPS site are operational. Preserve the
Cloudflare Tunnel's plain-HTTP service target exactly as shown above.
