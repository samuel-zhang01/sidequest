# SideQuest / Agent Godoy — unified agent memory

This is the concise, shared handoff for Codex agents working in this repository.
Read it after `infrastructure.md` and `README.md`. Update it whenever a task
materially changes the product contract, architecture, verified state, or known
limitations. Record tested facts, not intentions.

## Product north star

Agent Godoy turns private running evidence into a careful, actionable loop:

```text
Strava aggregates + live GPS + optional user context
  → non-diagnostic assessment
  → questions that reduce uncertainty
  → bounded interventions
  → editable challenges that friends or brands can back
  → observed outcome and reassessment
```

The social/funding mechanism must reward honest measurement and safe stopping,
never speed, suffering, or pushing through warning symptoms.

## Established, previously verified capabilities

- The browser uses same-origin `/api/...` routes through Nginx on the only
  host-published application port, `6969`.
- The Node API and Postgres stay private on the Compose network.
- The server imports aggregate runs from
  `db/data/strava/activities.csv`; the current export contains 209 usable runs.
- `STRAVA_OWNER_USER_ID` binds that private export to one stable owner. Blank
  welcome entry opens that owner profile, while named entries remain isolated
  friend profiles. The owner is explicitly migrated out of the legacy
  illustrative-user flag on startup.
- Automatic fallback observations, fabricated social runs, and automatic
  intervention/notification creation were removed. Home and YOU now render
  persisted Strava or Live observations, with honest empty states elsewhere.
- Browser GPS samples are validated and persisted server-side, then normalized
  into the same run-observation shape as Strava activities.
- The spectator map exposes rotated/coarsened doodle geometry rather than raw
  coordinates or street names, and cheers are persisted.
- The existing loop persists evidence snapshots, interventions, friend
  notifications, results, and reassessments.
- The public origin and HTTPS route were previously verified as documented in
  `infrastructure.md`. Do not infer that a later code change is deployed until
  it is checked again.

## Agent Godoy vertical slice — verified 2026-08-29

Status: **implemented, running locally, and reachable through the public HTTPS
route**.

Delivered capabilities:

- Added `api/agent/contracts.js` with strict Zod schemas. Zod is the Node-side
  equivalent of the requested Pydantic-style validated domain models.
- Added `api/agent/godoy.js` with a deterministic assessment engine, a Gemini
  structured-output provider, and an optional OpenAI Structured Outputs path.
- Model inputs contain aggregate recent-run data and user-supplied context;
  raw GPS samples and coordinates are excluded.
- Added persistence contracts for optional person context, Agent Godoy
  assessments, challenge metadata, and pledge commitments.
- Added API work for analysis, context ingestion, JSON export, selecting a
  suggested intervention, editing a challenge, and recording friend/brand
  pledges.
- Added UI work for optional context, Agent Godoy’s assessment/questions/
  intervention candidates, export, challenge editing, and a pledge board.
- Pledges are explicitly non-payment commitments; no payment is charged and no Stripe
  integration is claimed.
- Private feedback-loop reads, assessment/context/export writes, and owner-only
  challenge edits/results require a persisted guest session. An anonymous
  private export, analysis, or challenge edit returns `401`.
- Guest entry has one optional display-name field and no password, registration
  choice, verification, or account setup. The minimal opaque session exists
  only to separate concurrent phones; guest names are not secure identity.
- The sponsor `/live` view uses an authenticated same-origin WebSocket relay for
  ephemeral camera chunks. Metadata, viewer peaks, and cheers persist; video
  does not. A guest who is not broadcasting automatically joins the newest
  available stream, with muted autoplay for mobile browser compatibility. It
  is a limited-concurrency prototype rather than a production media pipeline.
- Replaced the post-login single-screen cockpit with a persistent four-part
  information architecture: Home, Live, Challenges, and Profile. Desktop
  uses a labelled side rail and phones use a labelled bottom bar. Home is now
  the default post-entry destination; explicit `/live` deep links still return
  there after guest entry.
- Combined live friend activity, the abstract map, GPS capture, camera and the
  start-run action into a single feed-first Live destination; intervention editing,
  pledges, friends, results, and reassessment remain in Challenges; and imported
  source metrics/history into Profile. The legacy Home evidence summary, quick
  actions, loop stepper, and standalone safety card were later removed so Home
  stays focused on timely social activity; private evidence remains in YOU and
  challenge-specific safety stops remain attached to challenges.
- Established `design-notes.md` as the shared product and interface contract,
  and added it to the required agent-reading sequence in `AGENTS.md`. It fixes
  the four destinations as Home, Live, Challenges, and Profile; defines
  their responsibilities and UI states; and records the data-driven object and
  visibility rules future features must preserve.
- Added persisted live-run charity challenges. A viewer can pledge a GBP
  amount to the runner's selected charity for a controlled next kilometre five
  seconds faster than the runner's recent average pace. The runner and viewers
  receive the challenge over the live WebSocket channel; no payment is charged,
  and the persisted safety rule treats stopping for warning symptoms as
  responsible completion.
- Hardened mobile live capture after a real phone reported `NotFoundError`:
  preferred rear-camera plus microphone capture now falls back to camera-only
  and then relaxed video constraints, while denied, busy, insecure, missing,
  and unsupported states receive actionable copy. Recorder MIME selection now
  accounts for video-only streams and covers WebM and Safari MP4 paths.
- Reduced live delay by moving from one-second to 400 ms recorder slices,
  reducing the late-join cache from 15 chunks to 3, bounding browser/WebSocket
  backlogs, trimming long playback buffers, and seeking lagging viewers toward
  the live edge.
- Completed the persisted live-challenge path that was present in the backend
  but absent from the interface: viewers can send a bounded charity
  pledge, and the runner sees each challenge immediately in a scrollable live
  studio feed with its sender, target pace, amount, charity, and safety rule.
- Implemented the design contract in the runtime UI. Home now opens with a
  bounded attention strip, friend/live avatar row, and API-produced activity
  feed cards; Run has a readiness/active-challenge summary above its private GPS
  controls and abstract map; Challenges exposes needs-response, active, and
  completed groups; Profile now owns private evidence coverage, history,
  assessment/next steps, context, export, and session controls.
- Added a server-side social Home projection assembled from persisted users,
  live sessions, and the current user's recent Strava or Live observations. It
  returns stable actor/feed IDs and server-derived status without exposing raw
  coordinates. Home also has explicit loading, empty, API failure, and
  disconnected states.
- The Home activity feed shows up to three recent persisted observations. Each
  card identifies its source and links back to YOU; fabricated friend runs,
  completed challenges, and donation claims are not used.
- Polished the four-destination UI with a minimalist copy system. Repeated page
  descriptions, privacy explainers, infrastructure copy, duplicate rationale,
  and narrated empty states were removed; controls, metrics, loading/errors,
  payment-boundary honesty, and concise safety stops remain visible. Live received
  the same treatment across its composer, feed, watch view, map, and challenge
  cards without changing the underlying camera, GPS, or pledge behavior.
- Reordered and renamed the four primary destinations to the owner-confirmed
  sequence **Home → YOU → Live → Challenge**. YOU is now visibly the second
  section and explicitly presents the private data layer: diagnostics, persisted
  run history, evidence coverage, settings/data, and LLM-generated next steps.
- Added a prominent **Generate next steps** action in YOU. It calls the existing
  authenticated Agent Godoy endpoint, persists the validated assessment and
  interventions, and makes each candidate selectable for the friend workflow.
- Corrected the friend-challenge direction. A selected intervention is now
  cloned into a persisted recipient-owned challenge with sender/recipient
  references; the sender sees it as sent and the friend sees it as incoming.
  Challenge shows the friend list, pledge target, status, and explicit accept or
  decline actions without exposing the sender's private evidence.
- Added persisted accept/decline responses for live challenges. The runner sees
  the controls in the Live cockpit, the backend enforces runner ownership, and
  the saved decision is relayed to viewers over the authenticated WebSocket.
  Live camera video remains ephemeral, while GPS observations, stream metadata,
  challenges, responses, and cheers remain associated with server-side users.

## Safety and language contract

- Never present the output as a diagnosis. Use “assessment,” “pattern,”
  “possible explanation,” or “things to clarify.”
- Never claim that tracker data establishes medical safety or causation.
- Chest discomfort, dizziness, faintness, unusual breathlessness, or concerning
  pain must stop the physical challenge and may warrant appropriate care.
- A safety stop counts as responsible completion for any backed challenge.
- Only share the public challenge and stop/settlement rules with friends or
  brands; keep private evidence and context private.

## Validation record — 2026-08-29

- `node --check` passed for the API and both Agent Godoy modules.
- The generated Zod JSON schema is a strict object with the expected
  assessment/questions/interventions/disclaimer properties.
- Inline JavaScript in `index.html` and `live.html` parsed successfully.
- `npm run build` pulled the three runtime images and passed Compose config.
- `npm run status` showed healthy web, API, and Postgres containers.
- Local `/health` returned `ok`; `/api/status` reported Postgres connected,
  `strava-export-v1`, `deterministic-fallback`, no diagnostic claims, and
  WebSocket fan-out.
- One authenticated QA flow verified: registration, empty state, context save,
  assessment (4 questions and 3 interventions), challenge adoption, edit,
  £5 pledge, and downloadable `agent-godoy-v1` JSON export. The isolated QA
  account and its records were removed afterward.
- Anonymous feedback-loop, Agent Godoy export/analysis, and challenge-edit
  checks returned `401`.
- `ss` showed port `6969` as the only app ingress; API and Postgres remained
  private on the Compose network.
- `https://genesis.hiddenlayers.co.uk/` returned `HTTP/2 200` through
  Cloudflare.
- A complete isolated regression passed guest join, live GPS validation and
  speed calculation, context save, Agent Godoy analysis, three validated
  interventions, adoption, owner edit, cross-user edit rejection, friend
  pledge/share, accept, result, reassessment, and JSON export. The export
  contained no raw latitude or longitude fields.
- Local and public `npm run test:live` runs passed in Chromium with fake camera
  hardware: guest join, MediaRecorder capture, WebSocket transmission,
  automatic second-user join, MediaSource buffering, live viewer count, cheer,
  and clean stream ending. The public test exercised HTTPS and `wss://` through
  Cloudflare.
- The updated local and public `npm run test:live` checks passed in a 390×844
  mobile context. They forced the first camera-plus-microphone request to fail
  with `NotFoundError`, verified camera-only recovery, checked the viewer
  remained under four seconds from the live edge, and confirmed a £7 challenge
  appeared immediately on the broadcaster screen. `npm run test:navigation`
  also remained green.
- A direct relay test also verified two simultaneous viewers and cached video
  delivery to a viewer joining after broadcast start.
- Local `npm run test:navigation` passed in Chromium after the navigation
  redesign. It verified Home as the post-login destination; visible labelled
  destinations; isolated Run, Challenge, and Profile content; active states;
  and the phone bottom-bar layout. The updated real-camera live regression also
  passed through the new Home → Live route.
- After the Run + Live merge, `npm run test:navigation` passed with exactly four
  primary destinations and Live as the only start-run entry point.
- The updated `npm run test:live` passed a two-browser flow covering camera
  relay, low-latency playback, GPS/map state, cheers, a persisted £5 pledge to
  Mind, live WebSocket delivery to the runner, and clean stream ending.
- The local health and status endpoints passed, all three Compose services were
  healthy, port `6969` remained the only published application port, and the
  public HTTPS page returned `HTTP/2 200` with the merged Live-feed UI.
- After the design-contract runtime build, `npm run build` passed image pulls
  and Compose validation; Node and both inline browser scripts parsed; local
  `/health` and `/api/status` passed with Postgres connected. The expanded
  navigation regression verified Home attention, people, feed, disclosure,
  Run readiness, all three challenge groups, Profile evidence/settings, and
  the phone bottom bar. The real-camera broadcaster/viewer regression also
  passed, including automatic join, video buffering, cheer persistence, viewer
  count, and clean stream ending. Mobile Home and Profile were visually
  inspected in Chromium after the build.
- The bounded Home doodle/challenge feed passed Node and inline-script parsing,
  `docker compose config --quiet`, local health/status checks, and the expanded
  navigation browser regression. Chromium inspection at 1280 px and 390 px
  confirmed all three split cards, six challenge completions, and responsive
  map/challenge presentation.
- The minimalist UI pass passed inline-script parsing, `git diff --check`, the
  full navigation regression, and the two-browser mobile live-camera regression.
  Home, Challenges, Profile, Live, and the 390 px Home layout were inspected in
  Chromium after the copy and spacing changes.
- The Home → YOU → Live → Challenge pass passed API and browser-script syntax,
  `git diff --check`, Compose validation, local health/status checks, the
  navigation browser regression, and both mobile live-browser regressions. A
  two-session API check persisted an LLM-derived friend challenge, recorded a
  recipient decline, then persisted an accepted £5 live challenge response.
- The legacy Home sidebar removal passed `git diff --check`, Compose
  validation, API syntax, local health/status checks, and the navigation
  browser regression. Mobile visual inspection confirmed the evidence hero,
  quick links, loop stepper, and standalone safety card no longer render.

## Model-provider verification — 2026-08-29

- The private `.env` contains a `gemini-api` alias. Its value was never printed,
  logged, committed, or copied into documentation.
- Google’s authenticated model listing returned `HTTP 200` and confirmed
  access to the selected Gemini models.
- Agent Godoy now prefers Gemini when either `GEMINI_API_KEY` or the existing
  `gemini-api` alias is available; OpenAI remains an optional secondary path.
- Google reported `gemini-2.5-flash` unavailable to new users and recommended
  `gemini-3.6-flash`, which is now the runtime default. A bounded retry can use
  `gemini-3.7-flash` for transient `429`, `503`, or timeout failures.
- A synthetic provider-level request returned `gemini-structured-output` and
  passed the complete local Zod output contract.
- A separate isolated guest exercised the real same-origin analysis endpoint.
  Postgres stored provider `google`, model `gemini-3.6-flash`, two questions,
  one intervention, and a Zod-validated assessment. The QA guest and its
  generated records were removed afterward.
- Gemini receives a reduced compatible JSON Schema, while full length, range,
  enum, and strict-object validation is still applied locally with Zod before
  any result is persisted.

## Live Me / Watch cockpit and mobile relay hardening — 2026-08-29

- Live now has a large, accessible **Me / Watch others** mode control. Me owns
  the runner setup and camera-first cockpit; Watch others owns the friend feed
  and selected stream. An active personal broadcast continues in the
  background with a clear return chip when the runner visits Watch others.
- The runner cockpit supports full-screen focus mode with an iOS-safe CSS
  fallback, large distance/pace/time values, a privacy-safe abstract route,
  GPS quality, viewer and connection state, sponsor context, a persistent
  challenge history, timed challenge cards and floating cheer reactions.
- The viewer stage now gives video visual priority while keeping the abstract
  route and live stats visible. It has explicit Unmute, Full screen and Leave
  stream controls plus persisted pledge challenges and one-tap cheers.
- Browser capture is staged before the persisted stream starts. WebKit/iOS
  MediaRecorder startup has MIME and timeslice fallbacks, GPS failure no longer
  tears down a working video broadcast, and unexpected recorder stops attempt
  visible recovery.
- The browser reconnects broadcaster and viewer sockets. The relay accepts an
  authenticated broadcaster takeover, keeps a 60-second mobile-handoff grace
  window, carries a bounded late-join media window and closes stale viewer
  sockets when a stream ends.
- The two-browser mobile regression passed sustained camera capture, viewer
  buffering, automatic join, fullscreen cockpit, GPS/map visibility, sponsor
  copy, a £9 Mind challenge, a fire reaction and clean shutdown. The baseline
  live-phone regression also passed. Separate targeted checks passed an
  iPhone-style MediaRecorder timeslice failure with MediaSource absent and a
  forced broadcaster socket takeover with the stream remaining live.
- Local and public health/status checks passed; all three Compose services are
  healthy and only port 6969 is published. Public HTTPS serves the updated Live
  page and a cache-busted JavaScript asset through Cloudflare.

## Infrastructure invariants

The authority is `infrastructure.md`. In short: publish only port `6969`; keep
internal services private; browser traffic stays same-origin; Cloudflare owns
public TLS; the tunnel origin remains plain HTTP at
`http://192.168.1.3:6969`; never expose or print `.env` or `.secrets/`.
