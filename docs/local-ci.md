# Synthetic local CI

Main pushes and explicit main dispatches use `[deploy-vps, sidequest]` at
192.168.1.52. No hosted compute or provider credential is used. External PR
code is not executed on the home runner.

The CI helper copies an explicit source allowlist, generates its own 209-row
activity fixture, installs the locked API dependencies and creates an isolated
Postgres/API/Nginx project. It reads no existing Strava export, private env,
media or production database. Provider keys are empty and the API/database
network has no outbound route. The only published application port is
loopback 6969; an occupied port fails without touching its owner.

The actual deterministic provider flow seeds challenges, followed by all
maintained navigation, challenge-object and fake-camera Live browser tests.
Cleanup selects only the randomly named CI project and its own database
volume. The existing deployed application, tunnel, DNS and production Compose
source are unchanged. Shared runner labels provide routing, not isolation.
