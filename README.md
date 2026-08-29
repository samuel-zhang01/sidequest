# SideQuest

SideQuest is a live social movement game for people who find exercising alone
boring. Friends can walk or run together in a shared room, broadcast GPS
position, react in real time and complete playful generated side quests. It is
not a professional pace tracker or an AI coach.

The current proof of concept is live at
<https://genesis.hiddenlayers.co.uk>.

## What works now

- Responsive Instagram-Live-style room UI.
- Seeded public rooms, movement history and private challenge preferences.
- Real same-origin API backed by Postgres.
- Room membership, reactions, messages and quest completions persist.
- Browser `watchPosition` sends validated GPS samples to the backend after the
  user explicitly enables sharing.
- The room refreshes from server state every five seconds.
- The server generates and stores safe side quests using room context and the
  participating members' private challenge limits.
- `/health` and `/api/status` expose operational state.

Quest generation is deliberately labelled `deterministic-poc`; it uses no
model or API key yet. The endpoint, context object, stored generation audit and
UI are ready for a later LLM provider without pretending the current rules are
AI.

## Run locally

```bash
npm run start
npm run status
```

Open <http://127.0.0.1:6969> or the public HTTPS URL above.

```bash
npm run logs
npm run down
```

`.env` and `.secrets/` remain private and are not served to the browser.

## Service topology

| Service | Exposure | Purpose |
| --- | --- | --- |
| `web` | Host port `6969` only | Nginx UI and same-origin `/api` gateway. |
| `api` | Compose network only | Node API, GPS validation, live-room behavior and quest generation. |
| `db` | Compose network only | Postgres rooms, members, locations, reactions and quests. |

## API proof points

| Route | Behavior |
| --- | --- |
| `GET /api/dashboard` | Seeded member context, movement history, rooms and current live room. |
| `GET /api/rooms/:id/live` | Latest persisted members, GPS positions, quests and reactions. |
| `POST /api/rooms/:id/join` | Join or resume a room as a walker or runner. |
| `POST /api/rooms/:id/location` | Validate and store a fresh GPS sample; reject stale or implausible movement. |
| `POST /api/rooms/:id/reactions` | Store a cheer, emoji or short message. |
| `POST /api/rooms/:id/sidequests/generate` | Generate and audit a context-aware safe side quest. |
| `POST /api/sidequests/:id/complete` | Count a completion once per member and update team progress. |

## Data and safety honesty

- Profiles, history and initial locations are clearly labelled demonstration
  data.
- New community actions and GPS samples are real server writes.
- Exact GPS is not uploaded until the user presses **Share GPS**.
- Generated challenges exclude categories that active members have privately
  marked to avoid.
- Wildlife disturbance, roads, trespass, blind/backwards movement and medical
  recommendations are outside the generator's allowed behavior.
- Every side quest is skippable without penalty.

## Next vertical slices

1. Replace five-second polling with server-sent events or WebSockets.
2. Add real authentication and public/friends-only room visibility.
3. Add voice notes and live voice reactions through a server-side provider.
4. Add an LLM behind the existing generator contract with structured output
   validation and the same safety filters.
5. Add Apple Health/Strava imports with explicit consent and source freshness.
6. Create replayable room stories after a session ends.

See [`infrastructure.md`](infrastructure.md) for the fixed ingress contract and
[`judging-criteria/`](judging-criteria/README.md) for the event brief.
