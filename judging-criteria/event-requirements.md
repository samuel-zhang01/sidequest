# RUN/HACK requirements and operating checklist

Last reconciled: 2026-08-29.

## Authoritative game rules

- Form a team of up to three people. Teams may be formed through the event
  WhatsApp group or on the day.
- The run/build window is a 5.5-hour relay.
- One teammate runs at a time, and the person running is the person building.
- Switch runners as often as desired.
- Building may happen only while a teammate is running. Screen sharing or a
  call with teammates at home base is allowed as a collaboration tactic.
- There are no fixed product categories or required languages/stacks.
- Organisers explicitly encourage running, movement, voice, live activity data
  and the unusual runner-to-team interaction.
- Originality matters more than polish. A surprising rough build can beat a
  predictable polished dashboard.
- Finalists may pitch while running, but this is optional.

## Eligibility: do not miss this

- No existing project, previous-hackathon repository or product already under
  development may be reused.
- Everything must start from nothing on the event day.
- Organisers may check first-commit evidence and agent session history.
- Judges do not alter BUILD scores for an eligibility concern; they flag it to
  organisers for a separate decision.
- Treat this repository as research only unless an organiser provides written
  clearance to reuse its implementation.

## Schedule and deliverables

| Time | Requirement |
| --- | --- |
| 10:30 | Doors, briefing and team formation. |
| 11:30 | Opening ceremony and warm-up. |
| 12:30 | Run/build window begins. Register the team when the form opens; without the form there is no leaderboard row. |
| 15:00 | Progress checkpoint described by the preparation material; confirm the exact submission channel at check-in. |
| 18:00 | Hands in. Submit team name, members, project name, one-line description, repository link, demo-video link and exported agent session history. |
| 18:00–19:00 | Judges choose the final five. |
| 19:00 | Finalist pitches. |
| 19:45–20:00 | Winner timing differs between live organiser pages; follow onsite announcements. |

The public event site displays both an `11:00` “gun” label and a detailed
schedule with a `12:30` run start. The detailed schedule and organiser brief
agree on the 12:30–18:00 build window, but the team should confirm it onsite.

## Running and tracking

- Distance is tracked by an app installed at check-in, with track lap counters
  as backup.
- The verified distance used in final scoring comes from the live RoxFit
  leaderboard: <https://app-production-36de.up.railway.app/>.
- The preparation guide requires RoxFit and Traccar Client to run together.
  Use continuous/background location permission, a nominated tracking phone
  and a portable charger; confirm both apps are feeding the board before the
  run starts.
- Event material describes a sub-7:00/km pace requirement; verify how pauses,
  handovers and GPS errors are adjudicated before the run begins.

## Scoring

```text
TEAM BUILD = total of judges' BUILD scores / number of judges
FINAL      = TEAM BUILD + verified team kilometres / 2
```

Distance is not scored by judges. Example: a BUILD score of 30 plus 50 km gives
a final score of 55.

Six judges score each build criterion from 0 to 5:

| Criterion | Weight | Maximum | What judges consider |
| --- | ---: | ---: | --- |
| Problem and customer need | ×1 | 5 | A real, painful or important problem; a clear user; credible evidence. |
| Fun, insight and originality | ×2 | 10 | Surprise, delight, a non-obvious insight and distinctiveness. |
| Solution, product and competitors | ×1 | 5 | A compelling response people would use and its advantage over alternatives. |
| Potential and upside | ×1 | 5 | Audience, market, usefulness, impact and room to grow. |
| Execution: it works | ×1 | 5 | What was built in the available time, demonstrated live, with reliability and usability. |
| Pitch | ×1 | 5 | Clarity, concision, engagement, subject knowledge and answers. |

The weighted BUILD maximum is 35. The organiser prose calls these “seven
criteria”; the published table contains six named criteria, with originality
counted twice through its ×2 weight.

### GTM challenge

The separate GTM challenge scores **ICP responses** at ×3, up to 15 points.
Judges consider the number and relevance of responses, genuine interest,
useful feedback, concrete next steps and commercial traction. The scale is
3 very weak, 6 weak, 9 solid, 12 strong and 15 exceptional.

## Prizes and participant credits

The Best Voice and Healf prizes are judged separately and may be won in
addition to a first-, second- or third-place prize.

| Award | Cash | Additional prize listed by organisers |
| --- | ---: | --- |
| First | £1,000 | Three Oura Ring 4 Silver devices, three Healf blood kits, three months of ElevenLabs Pro and $1,500 Thrad credits. |
| Second | £500 | Three WHOOP One 5.0 devices, three Healf blood kits and $1,000 Thrad credits. |
| Third | £250 | Three navy Theragun Relief devices and $500 Thrad credits. |
| Best ElevenLabs | — | Three months of ElevenLabs Scale. |
| Best GTM | — | Three Healf blood kits. |
| Best Healf | £350 | — |
| RoxFit Run Challenge | £250 | — |

Participant resources listed in the organiser brief:

- ElevenLabs: one month of Creator tier and 131,000 credits.
- Wispr Flow: one month of premium.
- Deepline: promo code `RUNNINGHACK`.
- Cognition × Poke: Devin and Poke access sent to the check-in email.
- Tavily: 8,000 credits total.
- O2: eSIMs.

## Preparation checklist

### Before 12:30

- [ ] Confirm the team has no more than three members.
- [ ] Ask organisers whether any scaffold, prepared asset or architecture note
      creates an eligibility problem.
- [ ] Install and verify the official distance-tracking app(s).
- [ ] Confirm the first GPS/lap-board reading and the pace rule.
- [ ] Connect every runner's phone to the chosen voice/agent workflow.
- [ ] Test microphone permission, mobile data and a runner-to-home-base call.
- [ ] Start screen and session recording before the first build action.
- [ ] Assign runner order, tracking owner, release owner and pitch owner.
- [ ] Prepare chargers, running kit and a fallback connectivity plan.

### Before 18:00

- [ ] Freeze risky changes by 17:30.
- [ ] Test the live demo on a second device and mobile data.
- [ ] Record a short, honest fallback demo.
- [ ] Export all agent session histories.
- [ ] Verify the first commit timestamp and repository visibility.
- [ ] Prepare all seven submission fields.
- [ ] Capture evidence of real ICP responses if entering the GTM challenge.
- [ ] Preserve screen recordings and the team's build vlog for the special
      behind-the-scenes challenge.

## Sources

- [How The Hack Works](https://shore-dingo-75a.notion.site/How-The-Hack-Works-3c8c9ef714788041b796ef14bccd438a)
- [How to Prepare for London's First Running Hackathon](https://shore-dingo-75a.notion.site/How-to-Prepare-for-London-s-First-Running-Hackathon-3c8c9ef7147881d49039ff6c9d14a9ea)
- [RUN/HACK public event page](https://www.therunninghackathon.com/)
