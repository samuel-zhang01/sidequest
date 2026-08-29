# Product idea — SideQuest Loop

## The problem

Run trackers collect data but rarely turn uncertainty into a useful next
measurement. Recommendations are also easy to ignore when nobody else is involved.

## The mechanism

SideQuest Loop makes peer pressure the behavioural engine and running data the
measurement engine:

1. **Observe:** normalize Strava, Garmin, GPS or future sources into run facts.
2. **Estimate:** summarize recent load, pace, heart-rate coverage and uncertainty.
3. **Ask:** identify a question the next run could answer.
4. **Intervene:** generate a bounded measurement task with a success rule and stop rule.
5. **Rally:** friends challenge the runner using only the shareable task.
6. **Reassess:** record the result, update the evidence and start again.

The example intervention is a conversational **+1 km signal run**. Distance,
time, pace, perceived effort and warning symptoms determine whether the result
supports the hypothesis, is inconclusive or produces a stop signal.

## Why it is extensible

Every input provider maps into one neutral observation schema. Every model
provider must return the same structured evidence/intervention contract. The
community and reassessment layers therefore survive a change from Strava to
Garmin, GPS to wearable data, or deterministic rules to a validated LLM.

## Product boundary

The app does not diagnose illness or clear a person for exercise. It describes
running signals, exposes uncertainty, collects missing evidence and prevents
peer pressure from overriding warning symptoms.

## POC evidence

- 209 real aggregate Strava run observations imported server-side.
- Real browser GPS → API → persisted observation path.
- Persisted analysis, intervention, friend challenge, result and reassessment.
- Transparent `deterministic-poc` engine ready for a later LLM provider.
- Public full-stack application on the required one-port architecture.
