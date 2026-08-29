# Whisperflow agent handoff

This repository is a hackathon project for **Whisperflow**: a spoken product
idea becomes an editable design-system brief (tokens, components, and a first
interface), then supports voice-led revisions.  Work as a careful product and
infrastructure collaborator—not as a generic code generator.

## Start here, every session

1. Read [`infrastructure.md`](infrastructure.md) in full. It is the authority
   for hosting, ports, Cloudflare, Docker, secrets, and engine access.
2. Read [`README.md`](README.md) for the runnable demo stack.
3. For pitch, product, or event work, read
   [`judging-criteria/judging-criteria.md`](judging-criteria/judging-criteria.md).
4. Inspect `git status --short` before editing. Preserve pre-existing user
   changes and never revert or overwrite unrelated work.

## Non-negotiable infrastructure rules

* Every new or replacement app is a **full-stack app**. It must have a browser
  UI, an application-owned backend API, and a real server-side integration or
  persistence layer where the product needs state. A static HTML-only page,
  browser-only mock, or client-side fake of a required API is not an acceptable
  delivery.
* Browser UI must use the app's same-origin `/api/...` routes for its product
  flow. Keep API, database, queue, and other internal services private on the
  Compose network; do not move business logic or secrets into browser code.
* The only host-published application port is **6969**. Never publish a second
  web, API, database, debug, or development port.
* The public application is always HTTPS at
  `https://genesis.hiddenlayers.co.uk`. Cloudflare owns TLS on 443; the engine
  tunnel must target the controller's plain-HTTP ingress at
  `http://192.168.1.3:6969`. Never configure the tunnel target as
  `https://192.168.1.3:6969`, add a Let's Encrypt certificate to port 6969, or
  change this target merely because the public site uses HTTPS.
* Browser code uses same-origin routes such as `/api/...`; backend and
  Postgres communication stays on the Compose network. Never expose their
  ports to work around a problem.
* `192.168.1.200` is the existing Docker engine/edge host. Do not add a new
  local Nginx architecture on this controller without the owner explicitly
  changing the architecture. Its connection details are documented in
  `infrastructure.md`.
* `.env` and `.secrets/` are private. Do not read them into output, commit
  them, copy them into documentation, or replace their contents.
* Do not modify Cloudflare, the remote engine, DNS, firewall rules, or external
  services unless the user explicitly asks for that action.

## How to make changes well

* First identify the smallest coherent change that satisfies the request.
  Follow the existing stack and style instead of adding parallel tooling.
* For every app change, deliver the complete vertical slice: usable UI,
  same-origin API endpoint(s), and real backend behavior. Include loading,
  failure, and empty states where they apply.
* Keep the implementation honest. Do not claim a product capability, user
  research result, or successful public deployment unless it was actually
  verified.
* When a feature changes the product flow, update the relevant README,
  infrastructure, or judging material in the same task when useful.
* Prefer clear, accessible UI and inspectable structured data over flashy,
  opaque output. The core product loop is voice → transcript → design-system
  decisions → rendered UI → voice revision.
* Use `apply_patch` for repository content changes. Avoid destructive commands
  and never discard user work.

## Validate before handoff

Choose checks proportionate to the change. For the demo stack, use:

```bash
docker compose config --quiet
npm run status
curl -fsS http://127.0.0.1:6969/health
curl -fsS http://127.0.0.1:6969/api/status
```

For an external deploy or tunnel change, also run the public HTTPS check from
`infrastructure.md` and report the result accurately. A Cloudflare `502` or
`525` is a tunnel/origin problem, not a reason to open extra ports or add TLS
to port 6969.

## Hackathon delivery priorities

The judging scorecard contains the live-event schedule and final-submission
requirements. Prioritise, in order:

1. A reliable end-to-end voice demo and one natural-language revision.
2. A readable one-screen judge view showing transcript, design-system choices,
   rendered UI, and fallback state.
3. A stable public demo/repo link plus the final submission details.
4. The 90-second demo and five-minute finalist pitch rehearsal.

Treat the 15:00 progress checkpoint and 18:00 final submission deadline in
the scorecard as hard delivery milestones.
