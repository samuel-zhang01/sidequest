# SideQuest Loop

SideQuest Loop is a peer-powered running feedback system. Its Agent Godoy layer
combines private running observations with optional user context, returns a
non-diagnostic assessment and useful follow-up questions, then proposes bounded
interventions that can become editable, backable challenges.

The live prototype is at <https://genesis.hiddenlayers.co.uk>.

```text
Observe → Estimate → Ask → Intervene → Rally → Reassess ↺
```

## What works

- A private backend adapter imports aggregate run records from the local Strava
  export. The current source contains 209 runs; raw export files are never
  served by Nginx.
- Live browser GPS sessions send samples through same-origin API routes. The
  server validates coordinates and plausible speed, derives distance/time/pace
  and stores the completed session as the same neutral run-observation shape.
- Leaving the welcome field blank opens Javi's stable owner profile associated
  with the private Strava export. Entering a display name creates or resumes a
  separate friend profile. A server session keeps concurrent phones and their
  data writes separate.
- After entry, the product opens on a focused Home view instead of sending the
  guest straight into a live stream. A persistent social-style navigation
  uses Home, YOU, Live, and Challenge, in that order. It becomes a labelled
  bottom bar on phones, while preserving the same destinations and active
  states.
- Home is a server-driven overview: a horizontally scrolling friend/live row
  and up to three recent activity cards rendered from persisted Strava or Live
  observations returned by the private API.
- YOU is the private data layer: source-backed diagnostics, saved Live/GPS run
  history, evidence coverage, and LLM-generated next steps live together with
  a prominent generation action. Live now has one prominent **Me / Watch others** control. Me opens the
  runner cockpit; Watch others opens the live friend feed and automatically
  joins the newest available run. The runner cockpit gives the camera,
  privacy-safe map, distance, pace, time, GPS quality and connection state a
  single focused view. Friends can watch, cheer, or persist a
  next-kilometre challenge with a charity pledge commitment; Challenge owns interventions,
  pledges, peers, outcomes, and reassessment. YOU also groups the latest assessment, proposed next
  steps, private context, export, and guest-session controls; Home links into
  those workflows without duplicating them.
- Spectators can follow an active run on a playful abstract map, switch between
  follow and overview views, zoom the doodle trail and send persisted cheers.
  The API rotates and coarsens route geometry; raw coordinates, accuracy and
  street names never reach the spectator response.
- `/live` is a sponsor-style camera studio and lobby. One broadcaster sends
  ephemeral camera chunks through the same-origin WebSocket relay to concurrent
  viewers. A guest who is not broadcasting automatically joins the newest
  available stream. Stream metadata, sponsor details, viewer peaks and cheers
  persist.
- The Live feed is also the only start-run entry point. A runner selects the
  charity for their stream; friends can pledge £1–£100 to a persisted next
  kilometre target five seconds faster than the runner's recent average. These
  do not charge payment, and safety stops count as responsible completion.
- Mobile broadcasting now retries a failed camera-plus-microphone request as a
  camera-only stream, uses phone-friendly capture constraints, and gives
  specific recovery copy for denied, busy, missing, insecure, and unsupported
  camera states. MediaRecorder startup has an iOS-safe timeslice fallback.
  Broadcasters and viewers reconnect after transient socket loss, with a
  60-second server grace window and authenticated broadcaster takeover for
  mobile network handoff. The relay uses short chunks, a bounded keyframe-sized
  late-join cache, bounded socket queues, and viewer live-edge catch-up.
- Viewers can send persisted, charity-backed live challenges without charging a
  payment. Challenges appear as timed cards over the runner's camera and remain
  in a history panel; cheers rise as lightweight live reactions. Both arrive
  over the existing authenticated WebSocket and persisted challenges remain
  visible after refresh.
- The runner can accept or decline each live challenge in the Live cockpit. The
  response is persisted and relayed to the viewer; sending a pledge does not
  silently opt the runner in.
- The insight layer compares the latest four runs with the prior four, states
  its evidence coverage and lists measurements that would reduce uncertainty.
- Agent Godoy returns a strict Zod-validated contract containing observed
  signals, possible explanations, limitations, questions and up to four
  challenge-ready interventions. Zod provides the Pydantic-style boundary for
  this Node stack.
- YOU presents that assessment as a chat: evidence-backed opening copy,
  selectable sample questions, and intervention cards. An explicitly external
  Healf Bloods option explains that running history contains no current blood
  biomarkers, links to Healf's source page, states eligibility limits, and is
  kept separate from challenge-ready model output.
- Each generated intervention is materialized as a reusable, owner-scoped
  challenge template in Postgres. Challenge separates **My challenges** from
  received and sent assignments; Live can instantiate the same template
  against the friend currently broadcasting. Both participants see the saved
  instance and only the recipient can accept or decline it.
- People can add private goal, recovery, symptom, schedule or medical context
  and export their complete Agent Godoy brief as JSON. Raw GPS coordinates are
  excluded from the agent input and export.
- Suggested interventions can be selected, edited and given a funding target.
  Friends or brands can add persisted pledge commitments; no payment is charged.
- The intervention layer persists a question, hypothesis, +1 km measurement
  task, success criteria, fields to collect and a safety stop.
- A runner can select an LLM-generated intervention, choose a friend, and send a
  persisted challenge with an optional pledge target. The recipient can accept or
  decline it; neither side sees the other's private evidence details.
- Distance, moving time, perceived effort and warning symptoms create a stored
  outcome. Reassessment then creates a new evidence snapshot and closes the loop.

When `GEMINI_API_KEY` (or the existing `gemini-api` alias) is configured, Agent
Godoy uses Gemini structured output and validates the result against the full
local Zod contract. OpenAI remains an optional secondary integration when only
`OPENAI_API_KEY` is configured. If a key is absent or the selected provider
fails, the same contract is populated by a clearly labelled
`deterministic-fallback`, so the full loop remains usable.

## Run

```bash
npm run start
npm run status
```

Open <http://127.0.0.1:6969> locally or the public HTTPS URL above.

The camera/automatic-join browser regression is runnable after installing the
Playwright Chromium binary once:

```bash
npx playwright install chromium
npm run test:navigation
npm run test:live
APP_URL=https://genesis.hiddenlayers.co.uk npm run test:live
```

`test:live` covers both the baseline two-phone flow and the Me/Watch cockpit,
full-screen, GPS, sponsor, challenge, reaction, sustained-capture regression.

## Architecture

| Service | Exposure | Responsibility |
| --- | --- | --- |
| `web` | Host port `6969` only | Responsive UI and same-origin API gateway. |
| `api` | Compose network only | Source adapters, GPS validation, loop engine and writes. |
| `db` | Compose network only | Observations, snapshots, interventions, notifications and outcomes. |

The API reads `db/data/strava/activities.csv` through a read-only private
mount. `.env`, `.secrets/` and raw activity files are not exposed to browsers.

## API proof points

| Route | Behavior |
| --- | --- |
| `GET /api/feedback-loop` | Return the complete persisted loop and source metadata. |
| `POST /api/auth/join` | Open the Strava-backed owner profile when blank, or enter a separate friend profile by display name. |
| `POST /api/agent-godoy/analyse` | Persist a validated assessment, questions and possible interventions. |
| `GET /api/challenge-templates` | Return the signed-in user's reusable generated and starter challenge objects. |
| `POST /api/challenge-templates/:id/assign` | Instantiate an owned challenge object for a selected friend. |
| `PATCH /api/challenge-assignments/:id/response` | Let the recipient accept or decline an assigned challenge. |
| `POST /api/context` | Add optional private person context for future analysis. |
| `GET /api/agent-godoy/export` | Download the signed-in runner's structured brief as JSON. |
| `POST /api/agent-godoy/challenges/:candidate/adopt` | Turn one suggested intervention into the active editable challenge. |
| `PATCH /api/interventions/:id/challenge` | Edit the owner’s public challenge fields and funding target. |
| `POST /api/interventions/:id/pledges` | Add a signed-in friend/brand pledge commitment without charging money. |
| `POST /api/feedback-loop/analyse` | Create a structured running-evidence snapshot. |
| `POST /api/feedback-loop/interventions` | Generate and audit a measurable intervention. |
| `POST /api/interventions/:id/share` | Persist a friend-to-runner challenge. |
| `POST /api/interventions/:id/accept` | Accept the measurement task. |
| `POST /api/interventions/:id/decline` | Decline a friend challenge without starting it. |
| `POST /api/interventions/:id/result` | Store distance, time, effort and symptoms. |
| `POST /api/interventions/:id/reassess` | Turn the result into the next evidence state. |
| `POST /api/gps-runs/start` | Start a private GPS session. |
| `POST /api/gps-runs/:id/samples` | Validate a fresh GPS sample and derive live pace. |
| `POST /api/gps-runs/:id/finish` | Normalize the GPS session into a run observation. |
| `POST /api/gps-runs/:id/cancel` | Close a GPS share that ended before enough movement. |
| `GET /api/live-map` | Return privacy-preserving doodle points and live run stats. |
| `POST /api/live-map/cheers` | Persist a spectator cheer on the active run. |
| `POST /api/live/streams/start` | Persist sponsor metadata and open a live broadcast. |
| `GET /api/live/streams` | List active and recently ended streams. |
| `POST /api/live/streams/:id/challenges` | Persist a next-kilometre charity pledge against a live friend. |
| `POST /api/live/streams/:id/challenges` | Persist a bounded live-run pledge challenge and relay it to the runner. |
| `PATCH /api/live/challenges/:id/response` | Persist and relay the runner's accept/decline choice. |
| `GET /api/live/ws` | Upgrade to the authenticated video fan-out channel. |

## Safety and honesty

- The app reports running load and response signals, not diagnoses.
- A score describes evidence coverage, not health or fitness.
- One intervention result cannot establish causation or medical safety.
- Agent Godoy uses “assessment” and “possible explanation,” never diagnosis or
  medical clearance. Its schema limits possibility confidence to low/moderate.
- Warning symptoms close the peer challenge; the UI never rewards pushing
  through them. A safety stop is responsible completion even when money is
  pledged.
- Strava aggregates and Live observations are persisted separately from model
  generation records.
- Spectators receive an abstract route shape rather than reconstructable map
  coordinates or named geography.
- Guest names are intentionally low-friction prototype identity, not authentication
  or an account system: names can be reused. Garmin/
  Strava OAuth, real push delivery, real payment processing, and durable video
  storage/transcoding are future work.
- The in-process WebSocket relay is suitable for limited hackathon concurrency,
  not internet-scale broadcasting; production needs a media service or
  SFU, adaptive bitrate, moderation and TURN/failover planning.

See [`infrastructure.md`](infrastructure.md) for the fixed one-port deployment
contract and [`judging-criteria/`](judging-criteria/README.md) for the pitch.
