# SideQuest Loop

SideQuest Loop is a peer-powered running feedback system. It turns running
observations into a measurable question, proposes a bounded intervention,
uses friends to create commitment, records the outcome and updates the next
evidence state.

The live POC is at <https://genesis.hiddenlayers.co.uk>.

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
- Spectators can follow an active run on a playful abstract map, switch between
  follow and overview views, zoom the doodle trail and send persisted cheers.
  The API rotates and coarsens route geometry; raw coordinates, accuracy and
  street names never reach the spectator response.
- The insight layer compares the latest four runs with the prior four, states
  its evidence coverage and lists measurements that would reduce uncertainty.
- The intervention layer persists a question, hypothesis, +1 km measurement
  task, success criteria, fields to collect and a safety stop.
- Individual friends can send persisted challenges. They see the task and stop
  rule, not the runner's private evidence details.
- Distance, moving time, perceived effort and warning symptoms create a stored
  outcome. Reassessment then creates a new evidence snapshot and closes the loop.

The generator is honestly labelled `deterministic-poc`; there is no model
provider yet. Its structured contract can later be implemented by an LLM
without changing source adapters, peer notifications or outcome handling.

## Run

```bash
npm run start
npm run status
```

Open <http://127.0.0.1:6969> locally or the public HTTPS URL above.

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
| `POST /api/feedback-loop/analyse` | Create a structured running-evidence snapshot. |
| `POST /api/feedback-loop/interventions` | Generate and audit a measurable intervention. |
| `POST /api/interventions/:id/share` | Persist a friend-to-runner challenge. |
| `POST /api/interventions/:id/accept` | Accept the measurement task. |
| `POST /api/interventions/:id/result` | Store distance, time, effort and symptoms. |
| `POST /api/interventions/:id/reassess` | Turn the result into the next evidence state. |
| `POST /api/gps-runs/start` | Start a private GPS session. |
| `POST /api/gps-runs/:id/samples` | Validate a fresh GPS sample and derive live pace. |
| `POST /api/gps-runs/:id/finish` | Normalize the GPS session into a run observation. |
| `GET /api/live-map` | Return privacy-preserving doodle points and live run stats. |
| `POST /api/live-map/cheers` | Persist a spectator cheer on the active run. |

## Safety and honesty

- The app reports running load and response signals, not diagnoses.
- A score describes evidence coverage, not health or fitness.
- One intervention result cannot establish causation or medical safety.
- Warning symptoms close the peer challenge; the UI never rewards pushing
  through them.
- Real Strava aggregates, seeded friends and deterministic generation are
  labelled separately.
- Spectators receive an abstract route shape rather than reconstructable map
  coordinates or named geography.
- Authentication, Garmin/Strava OAuth, real push delivery and an LLM provider
  are future work.

See [`infrastructure.md`](infrastructure.md) for the fixed one-port deployment
contract and [`judging-criteria/`](judging-criteria/README.md) for the pitch.
