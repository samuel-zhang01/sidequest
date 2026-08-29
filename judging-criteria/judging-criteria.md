# SideQuest — judging scorecard

> **Eligibility warning:** organisers disallow existing projects and may check
> first commits and agent sessions. Confirm whether this repository is eligible
> before submission.

```text
FINAL = average judge BUILD score + verified team kilometres / 2
```

## One-line pitch

SideQuest turns a lonely walk or run into a live multiplayer event where
friends react, follow along and generate playful challenges while you move.

## What judges should see

1. Open the public live room on two devices.
2. One device joins as a walker and shares GPS.
3. The home-base device sees the member appear and sends a reaction/message.
4. Generate a new side quest; show which private limits were applied without
   exposing health details.
5. Complete the quest and show team progress update.

The pivotal claim is **movement → live presence → community interaction →
shared side quest**, not “another run tracker with AI recommendations.”

## Rubric plan

| Criterion | Weight / maximum | Full-score case | Live evidence |
| --- | ---: | --- | --- |
| Problem and customer need | ×1 / 5 | Casual movers want activity and connection but find solo exercise boring or intimidating. | Name the first user and provide real observations from event attendees. |
| Fun, insight and originality | ×2 / 10 | Friends shape the activity while it happens; generated missions make an ordinary route surprising. | Have a judge react or request the next quest live. |
| Solution, product and competitors | ×1 / 5 | Unlike activity logs, training apps or passive live tracking, SideQuest makes spectators part of the workout. | Show the live room, reaction feed and completion state together. |
| Potential and upside | ×1 / 5 | Running clubs, remote friends, families, charity teams and workplace communities can create repeatable social movement formats. | Explain public/friends rooms, replay stories and health-aware generation. |
| Execution: it works | ×1 / 5 | GPS, room state, reactions, generated quests and completion persist through the API and Postgres. | Refresh both devices and prove state survives. |
| Pitch | ×1 / 5 | The setup is short, the live interaction is obvious and the distinction from serious fitness tracking is clear. | Start moving within 20 seconds of the pitch. |

**Target BUILD: 35 / 35.**

## Suggested 90-second demo

1. **0–10s — Problem.** “Fitness apps are great at telling you what you did.
   They are less good at making going outside feel socially irresistible.”
2. **10–25s — Join.** Join Saturday SideQuest as a walker and enable GPS.
3. **25–40s — Presence.** Point to the shared map and team active minutes.
4. **40–55s — Crowd.** Send a judge reaction/message from a second device.
5. **55–72s — Surprise.** Generate a safe side quest and show the applied
   constraints.
6. **72–84s — Completion.** Mark it complete and show team progress update.
7. **84–90s — Close.** “SideQuest makes movement multiplayer.”

## Evidence checklist

- [ ] A mobile browser can join a room as walk or run.
- [ ] Explicitly enabled GPS writes a fresh sample to the backend.
- [ ] A second browser sees the latest room state.
- [ ] Reactions and messages survive refresh.
- [ ] A side quest is generated server-side and stored with generation context.
- [ ] Private challenge limits exclude at least one category.
- [ ] Every side quest can be skipped without penalty.
- [ ] Completion is idempotent and updates team progress once.
- [ ] Seeded data and deterministic generation are labelled honestly.
- [ ] The public HTTPS URL is tested before pitching.
- [ ] A fallback recording shows the two-device interaction.

## Current implementation honesty

The proof of concept has a real UI → API → Postgres path, live GPS ingestion,
polling, room interactions and a deterministic quest generator. It does not yet
have production accounts, voice, Apple Health/Strava OAuth, WebSockets or an
LLM. Do not claim those features until implemented and verified.
