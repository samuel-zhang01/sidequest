# SideQuest product and interface contract

This is the shared design reference for every agent working on SideQuest. Read
it before changing navigation, page structure, UI copy, domain objects, or a
feature's placement. `infrastructure.md` remains authoritative for deployment,
and `achievements.md` remains authoritative for what has actually been built
and verified.

## Product shape

SideQuest is a mobile-first, social running app with an Instagram-inspired
rhythm: familiar cards, people-led activity, direct calls to action, and four
persistent destinations. It must still feel like SideQuest rather than a visual
copy of Instagram. The product loop is:

```text
Observe → Estimate → Ask → Intervene → Rally → Reassess ↺
```

After entry, there are exactly four primary destinations, in this order:

| Position | Destination | Icon idea | The question it answers |
| --- | --- | --- | --- |
| 1 | Home | House | What are my friends doing, and what needs my attention? |
| 2 | YOU | Person | What does my saved history say, and what should I try next? |
| 3 | Live | Play button in a route | Who is running, and can I watch, respond, or start my own run? |
| 4 | Challenge | Two-way challenge card | What have my friends and I committed to? |

Do not split Run and Live into separate primary tabs or add a fifth primary tab. Settings belongs inside YOU. Friend lists,
invitations, pledges, and challenge outcomes belong inside Challenge. Personal
diagnostics, history, and suggested next interventions belong inside YOU,
although Home may summarize urgent or timely items from either section.

## Entry screen

The entry screen is a gate, not one of the four destinations. The intended
product entry is one clear email field and a primary **Continue** action. It
should be calm, fast, and phone-friendly, with a short statement of the value
of entering SideQuest. Validation, submitting, failure, and returning-user
states must be visible and accessible.

The current hackathon prototype uses an optional display name and a
server-persisted guest session; it does not implement verified email identity.
Until real email authentication is delivered through a same-origin backend
flow, the UI and documentation must not claim account verification, password
login, or secure identity. A future email implementation replaces the entry
mechanism without changing the four-section information architecture.

On successful entry, open Home. Preserve an explicitly requested deep link,
such as `/live`, after entry.

## Shared mobile shell

- On phones, pin a four-item bottom navigation bar above the safe area. Every
  item has an icon and a short visible label; color alone never communicates
  the active state.
- On wider screens, the same four destinations may become a labelled side
  rail. Their names, order, URLs, and active states do not change.
- Keep one dominant action per screen. Secondary actions should not compete
  with starting a run, joining a live session, or responding to a challenge.
- Use a single scrolling column on small screens. Cards have consistent image
  or map regions, author headers, metadata, and action rows.
- Use large touch targets, readable type, strong contrast, safe-area spacing,
  visible focus states, reduced-motion support, and useful screen-reader
  labels. Icon-only controls require accessible names.
- Preserve state when moving between sections where practical. Returning from
  a friend's card should not unexpectedly reset the feed or an active run.
- Every data-backed region includes loading, empty, failure, stale, and
  disconnected states. A live indicator must reflect server state, not a
  decorative animation.

## 1. Home

Home is the social overview and the default destination. It is for scanning,
not for completing every workflow.

Top to bottom:

1. A compact attention strip shows at most a few timely items: a challenge to
   answer, a suggested intervention, a friend's live run, or a safe next step.
2. A horizontally scrollable friend/live row uses persisted user profiles.
   A live friend is clearly marked; tapping opens their live detail. When no
   friends exist, the row shows an honest empty state.
3. The main feed contains reusable activity cards. A card has the friend's
   picture/avatar and name at the top, a privacy-safe live or completed route
   map as the main visual, useful run metadata, and a short action row.
4. Relevant calls to action include **Watch live**, **Cheer**, **Challenge**,
   and **View result**. Each action opens the owning destination or detail;
   Home does not duplicate the full challenge or broadcast tools.

Feed ranking should prioritize live activity, direct invitations, recent
friend outcomes, and genuinely useful interventions. Avoid an endless wall of
private analytics. Safety notices and private health context never appear in a
friend's public card.

## 2. YOU

YOU is the private data layer. It opens with the user's evidence coverage and
latest non-diagnostic assessment, then shows source-backed run history,
completed outcomes, and LLM-generated next steps. A prominent **Generate next
steps** action creates a fresh validated assessment and intervention candidates
from the user's server-persisted evidence. A selected candidate can be sent to
a friend from Challenge.

Live GPS sessions, aggregate run outcomes, effort, and challenge responses are
persisted in Postgres against the signed-in user and appear here after refresh.
Ephemeral camera video is explicitly not recorded. Private goals, recovery,
symptoms, schedules, and medical context remain owner-only.

## 3. Live + Run

Live owns real-time presence and the runner's active movement session. It opens
as a feed of active friend runs: people-led camera/route cards show live state,
viewer count, current challenges, charity, and clear **Watch**, **Cheer**, and
**Challenge** actions. A prominent composer-style **Start your run** action is
the primary creator entry point on the same screen.

Inside Live, a large two-option tab control separates **Me** from **Watch
others**. These are view modes, not additional primary navigation
destinations. Me owns setup and the active runner cockpit. Watch others owns
the live friend feed and selected viewer stage. If the current user is live,
switching to Watch others must leave the broadcast running and provide an
obvious return-to-my-run control.

Before starting, the runner chooses the charity attached to live pledges. During
a run, the creator card becomes a focused camera/GPS dashboard with elapsed
time, distance, pace, connection quality, the abstract route, and a clear
**Finish run** action. Raw coordinates stay private; friends receive only the
server-produced abstract route.

A broadcast/view screen gives the camera the visual priority, keeps route
stats and cheers legible, and makes leave/end controls unmistakable. Viewers
can send lightweight cheers or challenge the next controlled kilometre above
the runner's recent average pace with a pledge to the runner's chosen charity.
The pledge is explicitly a commitment and is not charged. A safety stop counts
as responsible completion. Viewers cannot see raw coordinates, street names,
private evidence, or private user context.

After finishing, collect only useful outcome fields, such as perceived effort
and warning symptoms, then show how the observation updates the user's loop.
Paused, denied-location, weak-GPS, offline, too-little-movement, safe-stop, and
upload-retry states must have explicit recovery paths.

Permission denied, no active streams, connection loss, automatic rejoin,
muted autoplay, ended stream, and unsupported-camera states must be designed
as first-class states. Never imply that ephemeral prototype video is recorded or
durably stored.

Incoming live challenges are persisted immediately and appear in the runner's
Live cockpit with explicit **Accept** and **Decline** actions. The response is
stored and relayed back to viewers; no challenge starts merely because it was
sent.

## 4. Challenge

Challenge owns the social commitment system: friends, invitations,
interventions, pledges, active commitments, results, and reassessment.

The first view should separate items that need action from the browsable
friend list. Useful groups are **Needs your response**, **Active**, and
**Completed**. Friend rows show avatar, name, relevant running status, and one
contextual action. Opening a friend reveals only shareable information and a
**Challenge them** flow.

A challenge is an editable domain object, not a fixed card. Its detail includes
owner and participants, title, measurable task, due date, success measure,
safety-stop rule, status, optional pledge target, pledge ledger, and outcome.
The primary action changes with state: send, accept, record result, or reassess.
A safety stop is responsible completion and must never be styled as failure.
Pledges remain clearly labelled commitments unless real payment processing is
implemented and verified.

## Data-driven architecture

The interface is assembled from domain objects returned by same-origin
`/api/...` routes. It must not be built as a collection of one-off, hard-coded
friend cards. Activity and social content must come from persisted records;
empty states are shown when no records exist.

Core objects and relationships:

```text
User
├── Profile and settings
├── Friendships ──> User
├── RunSessions ──> route summary + live state + outcome
├── FeedItems ──> actor + run/challenge/live-session reference
├── Assessments ──> evidence signals + questions + interventions
└── Challenges
    ├── owner and participants
    ├── intervention and safety rule
    ├── pledges
    └── result ──> reassessment
```

Each object has a stable ID, owner/actor reference, timestamps, visibility,
and a server-derived status. UI cards render object data and emit actions by
ID; they do not own business truth. The backend enforces ownership and
visibility, persists state in Postgres, and returns shareable projections that
exclude private fields. Browser UI uses only same-origin routes. Internal API,
database, model credentials, and raw GPS data stay off the public network.

## Placement rule for future features

Place a feature according to the user's primary intent:

- Scan people and timely activity → Home.
- Scan live friends, start/monitor/finish personal movement, or watch real-time
  video/presence → Live.
- Understand personal history, evidence, next steps, data, or settings → YOU.
- Ask, invite, commit, pledge, report, or reassess with others → Challenge.

Home may link to any of these, but the full workflow lives in exactly one
owning section. New features must preserve the complete vertical slice:
responsive UI, same-origin API behavior, private backend logic, persistence
where state is required, and honest loading/failure/empty states.
