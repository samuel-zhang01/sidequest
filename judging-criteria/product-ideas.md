# Product direction: SideQuest

## Chosen concept

**SideQuest** is a live social movement game for people who want to be active
but find doing it alone boring.

> Move together. Make it weird.

Members join a live room as walkers or runners, share location, receive
reactions from friends and complete playful generated missions. The product is
not an AI coach, professional training plan or pace-optimisation dashboard.

## Core insight

Most fitness products record what happened after a workout. SideQuest makes
the activity socially entertaining while it is happening. Spectators are not
passive: their reactions, suggestions and votes shape the session.

## Magical loop

```text
Join a live room
      ↓
Walk/run with shared GPS presence
      ↓
Friends react and propose energy
      ↓
Generator creates one safe local side quest
      ↓
Team completes or skips it
      ↓
The room becomes a replayable shared story
```

## Side-quest examples

- Find a circle, square and triangle visible from public paths.
- Move silently for one minute, then share the strangest sound noticed.
- Reach an accessible landmark and post an unnecessarily dramatic arrival.
- Spot three birds from a respectful distance without approaching or changing
  their behaviour.
- In a clear pedestrian-free space, mirror one teammate's gentle arm rhythm.
- Let spectators vote on the most aggressively colourful object found.

Creative prompts must never encourage disturbing wildlife, trespass, road use,
blind or backwards movement, or overriding pain/fatigue.

## Why it fits RUN/HACK

- Movement is the product input, not an event-themed decoration.
- It turns the event's runner/home-base separation into a spectator mechanic.
- Live reactions provide a visible crowd moment for judges.
- Generated side quests create surprise, the double-weighted criterion.
- Walking works as well as running, widening the first audience.
- Voice reactions and spoken missions are a natural ElevenLabs extension.

## Current MVP

- Seeded accounts and rooms.
- Walk/run membership.
- Real GPS ingestion and persisted latest location.
- Live-room polling.
- Real reactions and messages.
- Server-generated, persisted side quests.
- Private challenge preferences that filter unsafe/inappropriate categories.
- Quest completion and team progress.

## Metric model

The default experience deliberately avoids professional pace emphasis.

| Role | Metric | Definition |
| --- | --- | --- |
| Primary outcome | Team active minutes | Sum of active minutes across joined movers in the room. |
| Engagement | Live reactions | Persisted emoji and messages sent to a room. |
| Product depth | Side quests completed | Unique member/quest completions. |
| Participation | Movers and spectators | Joined moving members and current room audience. |
| Personal context | Days outside | Distinct days with a recorded movement session. |
| Guardrail | Skips and excluded categories | Challenges skipped or filtered by private limits. |

Distance is supporting context. Pace is intentionally excluded from the hero
metrics.

## Architecture mapping

```text
Mobile browser GPS + community interactions
                 │ same-origin /api/...
                 ▼
        Nginx gateway on :6969
                 │
                 ▼
     private Node API → quest generator
                 │
                 ▼
      private Postgres live-room state
```

Polling is sufficient for the proof of concept. Server-sent events or
WebSockets can replace it later without changing the persisted event model.

## Deferred deliberately

- Production authentication and follower graphs.
- Real Apple Health and Strava OAuth.
- Background GPS/PWA guarantees.
- Voice transcription and generated speech.
- LLM generation; the first backend is explicitly labelled deterministic.
- Photos and automated completion verification.
- Push notifications and public route discovery.
