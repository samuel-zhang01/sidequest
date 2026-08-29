# SideQuest Loop — judging scorecard

> **Eligibility warning:** organisers may disallow existing projects and may
> inspect first commits or agent sessions. Confirm eligibility before entering.

## One-line pitch

SideQuest turns every run into a question, every friend into a commitment
mechanism and every outcome into better evidence for what to try next.

## What judges should see

1. Open the public loop and show the source adapter: 209 imported runs,
   coverage, freshness and recent distance history.
2. Explain the evidence state, comparison window and missing perceived-effort
   data; the confidence score measures coverage, not health.
3. Show Agent Godoy’s separate evidence signals, possible explanations,
   follow-up questions and three challenge-ready interventions. Select one,
   edit its public brief and add a pledge commitment that charges no payment.
4. Join as guests on two devices—no account or password. Start GPS and sponsor
   video on one; the other automatically joins the camera and abstract route,
   then sends a persisted cheer without exposing a street or coordinate.
5. Have a judge choose a friend and send a persisted challenge.
6. Accept the run, record an outcome and press **Reassess**.
7. Show that the next evidence state is persisted and the loop is closed.

## Rubric fit

| Criterion | Full-score case | Evidence |
| --- | --- | --- |
| Problem | Fitness data is abundant; useful next measurements and adherence are scarce. | Source coverage plus explicit data gaps. |
| Originality | Peer pressure is connected to a structured learning loop, not a generic social feed. | Privacy-safe live map, spectator cheer and friend challenge. |
| Product | Source and model layers are replaceable while the loop remains stable. | Neutral observation and intervention contracts. |
| Potential | Wearables, clubs, remote friends and supervised programs can supply richer signals. | Source adapter and private/shareable split. |
| Execution | Every stage crosses UI → same-origin API → Postgres. | Refresh after each action and show persisted state. |
| Trust | The product separates evidence, inference, uncertainty and safety boundaries. | Non-diagnostic copy and symptom stop path. |

## Suggested 90-second walkthrough

1. **0–12s:** “Trackers tell you what happened. SideQuest tells your friends
   which measurable run to hold you to—and checks if it taught us anything.”
2. **12–28s:** Show 209 source-backed runs and the recent-vs-baseline chart.
3. **28–43s:** Show the evidence state, coverage score and missing RPE.
4. **43–58s:** Start GPS and show the doodle route move on a second screen.
5. **58–70s:** Send a map cheer, then show the question and stop rule.
6. **70–84s:** Record the result and reassess.
7. **84–90s:** “Observe, intervene, rally, reassess—then repeat.”

## Implementation honesty

The prototype has a real Strava export adapter, live GPS endpoint, abstract spectator
map, passwordless sessions, an authenticated WebSocket camera relay,
strict Zod Agent Godoy contracts, private Node API, Postgres state and full loop
closure. Guest entry needs no account, password, or verification; its opaque
session only separates concurrent users and is not secure authentication.
Agent Godoy uses OpenAI Structured Outputs when configured and a
labelled deterministic fallback otherwise. The spectator API does
not return raw coordinates or street data. Video is ephemeral and the
in-process relay is a limited-concurrency prototype, not a production media
CDN. Friends are persisted user profiles and delivery is shown in-app. Pledges
are persisted commitments and never charge money. OAuth, external notifications, payment
processing and medical interpretation are not implemented.
