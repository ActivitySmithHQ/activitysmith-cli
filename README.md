# ActivitySmith CLI

CLI wrapper for the ActivitySmith API using the official Node SDK.

## Install

```bash
npm install -g activitysmith-cli
```

## Install Skill (Codex/Claude/Other Skills-Compatible Agents)

Install the public skill from this repo:

```bash
npx skills add ActivitySmithHQ/activitysmith-cli --skill activitysmith
```

Skill path in this repo:

```text
skills/activitysmith
```

The skill is agent-neutral and uses `ACTIVITYSMITH_API_KEY` auth plus the same CLI commands shown below.

## Auth

Set `ACTIVITYSMITH_API_KEY` or pass `--api-key`.

For the skill scripts, you can also copy `skills/activitysmith/.env.example` to `skills/activitysmith/.env`.

## Push Notifications

Run `activitysmith --help` to inspect available commands.

### Send Push Notification

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch"
```

### Rich Push Notifications with Media

<p align="center">
  <img src="https://cdn.activitysmith.com/features/rich-push-notification-with-image.png" alt="Rich push notification with image" width="680" />
</p>

```bash
activitysmith push \
  --title "Homepage ready" \
  --message "Your agent finished the redesign." \
  --media "https://cdn.example.com/output/homepage-v2.png" \
  --redirection "https://github.com/acme/web/pull/482"
```

Send images, videos, or audio with your push notifications, press and hold to preview media directly from the notification, then tap through to open the linked content.

<p align="center">
  <img src="https://cdn.activitysmith.com/features/rich-push-notification-with-audio.png" alt="Rich push notification with audio" width="680" />
</p>

What will work:

- direct image URL: `.jpg`, `.png`, `.gif`, etc.
- direct audio file URL: `.mp3`, `.m4a`, etc.
- direct video file URL: `.mp4`, `.mov`, etc.
- URL that responds with a proper media `Content-Type`, even if the path has no extension

`--media` can be combined with `--redirection`, but not with `--actions` or `--actions-file`.

### Actionable Push Notifications

<p align="center">
  <img src="https://cdn.activitysmith.com/features/actionable-push-notifications-2.png" alt="Actionable push notification example" width="680" />
</p>

Actionable push notifications can open a URL on tap or trigger actions when someone long-presses the notification.
Webhooks are executed by the ActivitySmith backend.

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch" \
  --redirection "https://github.com/org/repo/actions/runs/123456789" \
  --actions '[{"title":"Open Failing Run","type":"open_url","url":"https://github.com/org/repo/actions/runs/123456789"},{"title":"Create Incident","type":"webhook","url":"https://hooks.example.com/incidents/create","method":"POST","body":{"service":"payments-api","severity":"high","source":"activitysmith-cli"}}]'
```

You can also load actions from a file:

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch" \
  --actions-file "./actions.json"
```

## Live Activities

Live Activities come in two UI types, but the lifecycle stays the same:
start the activity, keep the returned `activity_id`, update it as state
changes, then end it when the work is done.

- `segmented_progress`: best for jobs tracked in steps
- `progress`: best for jobs tracked as a percentage or numeric range

### Shared flow

1. Run `activitysmith activity start ...`.
2. Save the returned `activity_id`.
3. Run `activitysmith activity update ...` as progress changes.
4. Run `activitysmith activity end ...` when the work is finished.

You can use `--content-state <json>` for the examples below, or build the same
payload with flags as documented in `Content State Options`.

### Segmented Progress Type

Use `segmented_progress` when progress is easier to follow as steps instead of a
raw percentage. It fits jobs like deployments, backups, ETL pipelines, and
checklists where "step 2 of 3" is more useful than "67%".
`numberOfSteps` is dynamic, so you can increase or decrease it later if the
workflow changes.

#### Start

<p align="center">
  <img src="https://cdn.activitysmith.com/features/start-live-activity.png" alt="Segmented progress start example" width="680" />
</p>

```bash
activitysmith activity start \
  --content-state '{"title":"Nightly database backup","subtitle":"create snapshot","numberOfSteps":3,"currentStep":1,"type":"segmented_progress","color":"yellow"}' \
  --channels "devs,ops"
```

#### Update

<p align="center">
  <img src="https://cdn.activitysmith.com/features/update-live-activity.png" alt="Segmented progress update example" width="680" />
</p>

```bash
activitysmith activity update \
  --activity-id "<activityId>" \
  --content-state '{"title":"Nightly database backup","subtitle":"upload archive","numberOfSteps":4,"currentStep":2}'
```

#### End

<p align="center">
  <img src="https://cdn.activitysmith.com/features/end-live-activity.png" alt="Segmented progress end example" width="680" />
</p>

```bash
activitysmith activity end \
  --activity-id "<activityId>" \
  --content-state '{"title":"Nightly database backup","subtitle":"verify restore","numberOfSteps":4,"currentStep":4,"autoDismissMinutes":2}'
```

### Progress Type

Use `progress` when the state is naturally continuous. It fits charging,
downloads, sync jobs, uploads, timers, and any flow where a percentage or
numeric range is the clearest signal.

#### Start

<p align="center">
  <img src="https://cdn.activitysmith.com/features/progress-live-activity-start.png" alt="Progress start example" width="680" />
</p>

```bash
activitysmith activity start \
  --content-state '{"title":"EV Charging","subtitle":"Added 30 mi range","percentage":15,"type":"progress","color":"lime"}'
```

#### Update

<p align="center">
  <img src="https://cdn.activitysmith.com/features/progress-live-activity-update.png" alt="Progress update example" width="680" />
</p>

```bash
activitysmith activity update \
  --activity-id "<activityId>" \
  --content-state '{"title":"EV Charging","subtitle":"Added 120 mi range","percentage":60}'
```

#### End

<p align="center">
  <img src="https://cdn.activitysmith.com/features/progress-live-activity-end.png" alt="Progress end example" width="680" />
</p>

```bash
activitysmith activity end \
  --activity-id "<activityId>" \
  --content-state '{"title":"EV Charging","subtitle":"Added 200 mi range","percentage":100,"autoDismissMinutes":2}'
```

## Channels

Channels are used to target specific team members or devices. Can be used for both push notifications and live activities.

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch" \
  --channels "devs,ops"
```

## Aliases

The CLI installs two bin names:

- `activitysmith` (recommended)
- `activitysmith-cli` (alias)

## Content State Options

For `activity start|update|end`, you can pass content state via JSON:

- `--content-state <json>`
- `--content-state-file <path>`

Or use flags to build the payload:

- `--title <title>`
- `--subtitle <subtitle>`
- `--type <type>`
- `--number-of-steps <number>`
- `--current-step <number>`
- `--percentage <number>`
- `--value <number>`
- `--upper-limit <number>`
- `--color <color>`
- `--step-color <color>`
- `--auto-dismiss-minutes <number>`

Targeting options:

- `--channels <comma-separated-slugs>` (for `push` and `activity start`)

Required fields:

- `activity start`: `--title`, `--type`, plus either `--number-of-steps` and `--current-step`, or `--percentage`, or `--value` with `--upper-limit`
- `activity update`: `--title`, plus either `--current-step`, or `--percentage`, or `--value` with `--upper-limit`
- `activity end`: `--title`, plus either `--current-step`, or `--percentage`, or `--value` with `--upper-limit`

## Output

Use `--json` for machine-readable output.

```bash
activitysmith push --title "Hello" --json
```
