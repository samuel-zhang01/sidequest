# SideQuest handover

- Public demo: https://genesis.hiddenlayers.co.uk
- Verified: 29 August 2026 (UTC). Homepage, `/api/status`, and `/api/dashboard` returned HTTP 200; web, API, and Postgres containers were healthy.
- Working POC: live movement rooms, seeded members, GPS sharing, reactions, team side quests, and persisted completions.
- Current limits: seeded accounts/data, five-second polling, and a transparent deterministic challenge generator; voice, WebSockets, Strava, and Apple Health are future work.
- Infrastructure: Cloudflare HTTPS routes to the single published application port, `6969`; API and Postgres stay private.
