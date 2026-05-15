# ActivitySmith CLI

CLI wrapper for the ActivitySmith API using the official Node SDK.

## Table of Contents

- [Install](#install)
- [Install Skill (Codex/Claude/Other Skills-Compatible Agents)](#install-skill-codexclaudeother-skills-compatible-agents)
- [Auth](#auth)
- [Push Notifications](#push-notifications)
  - [Send Push Notification](#send-push-notification)
  - [Rich Push Notifications with Media](#rich-push-notifications-with-media)
  - [Actionable Push Notifications](#actionable-push-notifications)
- [Live Activities](#live-activities)
  - [Start & Update Live Activity](#start--update-live-activity)
  - [End Live Activity](#end-live-activity)
  - [Live Activity Action](#live-activity-action)
- [Channels](#channels)
- [Widgets](#widgets)
- [Aliases](#aliases)
- [Content State Options](#content-state-options)
- [Output](#output)

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
  --actions '[
    {
      "title": "Open Failing Run",
      "type": "open_url",
      "url": "https://github.com/org/repo/actions/runs/123456789"
    },
    {
      "title": "Create Incident",
      "type": "webhook",
      "url": "https://hooks.example.com/incidents/create",
      "method": "POST",
      "body": {
        "service": "payments-api",
        "severity": "high",
        "source": "activitysmith-cli"
      }
    }
  ]'
```

You can also load actions from a file:

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch" \
  --actions-file "./actions.json"
```

## Live Activities

There are four types of Live Activities:

- `stats`: best for showing business numbers side by side, such as revenue, sales, new users, conversion, refunds, or any other value you want visible at a glance
- `metrics`: best for live percentage values that change often, like server CPU, memory usage, disk usage, or error rate
- `segmented_progress`: best for anything that moves through clear stages, like deployments, onboarding flows, backups, ETL pipelines, migrations, and AI agent runs
- `progress`: best for tracking real-time progress with percentage, like tasks, backups, migrations, syncs, or uploads

### Start & Update Live Activity

Use a stable `stream_key` to identify the metric, job, deployment, or system you want to keep visible. The first `activity stream` command starts the Live Activity. Later commands with the same `stream_key` update it.

#### Stats

<p align="center">
  <img
    src="https://cdn.activitysmith.com/features/stats-live-activity.png"
    alt="Stats Live Activity stream example"
    width="680"
  />
</p>

```bash
activitysmith activity stream sales-hourly \
  --content-state '{
    "title": "Sales",
    "subtitle": "last hour",
    "type": "stats",
    "metrics": [
      { "label": "Revenue", "value": "$2430", "color": "blue" },
      { "label": "Orders", "value": "37", "color": "green" },
      { "label": "Conversion", "value": "4.8%", "color": "magenta" },
      { "label": "Avg Order", "value": "$65.68", "color": "yellow" },
      { "label": "Refunds", "value": "$84", "color": "red" },
      { "label": "New Buyers", "value": "18", "color": "cyan" }
    ]
  }'
```

#### Metrics

<p align="center">
  <img
    src="https://cdn.activitysmith.com/features/metrics-live-activity-start.png"
    alt="Metrics Live Activity stream example"
    width="680"
  />
</p>

```bash
activitysmith activity stream prod-web-1 \
  --content-state '{
    "title": "Server Health",
    "subtitle": "prod-web-1",
    "type": "metrics",
    "metrics": [
      { "label": "CPU", "value": 9, "unit": "%" },
      { "label": "MEM", "value": 45, "unit": "%" }
    ]
  }'
```

#### Segmented Progress

<p align="center">
  <img
    src="https://cdn.activitysmith.com/features/update-live-activity.png"
    alt="Segmented Progress Live Activity stream example"
    width="680"
  />
</p>

```bash
activitysmith activity stream nightly-backup \
  --content-state '{
    "title": "Nightly Backup",
    "subtitle": "upload archive",
    "type": "segmented_progress",
    "numberOfSteps": 3,
    "currentStep": 2
  }'
```

#### Progress

<p align="center">
  <img
    src="https://cdn.activitysmith.com/features/progress-live-activity.png"
    alt="Progress Live Activity stream example"
    width="680"
  />
</p>

```bash
activitysmith activity stream search-reindex \
  --content-state '{
    "title": "Search Reindex",
    "subtitle": "catalog-v2",
    "type": "progress",
    "percentage": 42
  }'
```

### End Live Activity

Call `activity end-stream` with the same `stream_key` to dismiss the Live Activity. You can include final values before it is removed. By default, iOS removes the Live Activity after two minutes. Set `autoDismissMinutes` to choose a different dismissal time, including `0` for immediate dismissal.

```bash
activitysmith activity end-stream prod-web-1 \
  --content-state '{
    "title": "Server Health",
    "subtitle": "prod-web-1",
    "type": "metrics",
    "metrics": [
      { "label": "CPU", "value": 7, "unit": "%" },
      { "label": "MEM", "value": 38, "unit": "%" }
    ],
    "autoDismissMinutes": 2
  }'
```

### Live Activity Action

Live Activities can include one optional action button. Use it to open a URL from the Live Activity or trigger a backend webhook.

<p align="center">
  <img
    src="https://cdn.activitysmith.com/features/live-activity-with-action.png?v=20260319-1"
    alt="Live Activity with action button"
    width="680"
  />
</p>

#### Open URL action

```bash
activitysmith activity stream prod-web-1 \
  --content-state '{
    "title": "Server Health",
    "subtitle": "prod-web-1",
    "type": "metrics",
    "metrics": [
      { "label": "CPU", "value": 76, "unit": "%" },
      { "label": "MEM", "value": 52, "unit": "%" }
    ]
  }' \
  --action '{
    "title": "Open Dashboard",
    "type": "open_url",
    "url": "https://ops.example.com/servers/prod-web-1"
  }'
```

#### Webhook action

```bash
activitysmith activity stream search-reindex \
  --content-state '{
    "title": "Reindexing product search",
    "subtitle": "Shard 7 of 12",
    "type": "segmented_progress",
    "numberOfSteps": 12,
    "currentStep": 7
  }' \
  --action '{
    "title": "Pause Reindex",
    "type": "webhook",
    "url": "https://ops.example.com/hooks/search/reindex/pause",
    "method": "POST",
    "body": {
      "job_id": "reindex-2026-03-19",
      "requested_by": "activitysmith-cli"
    }
  }'
```

## Channels

Channels are used to target specific team members or devices. Can be used for both push notifications and live activities.

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch" \
  --channels "devs,ops"
```

## Widgets

<p align="center">
  <img src="https://cdn.activitysmith.com/features/lock-screen-widgets.png" alt="Lock screen widgets" width="680" />
</p>

ActivitySmith lets you display any value on your Lock Screen with widgets - SaaS metrics, revenue, signups, uptime, habits, or anything else you want to track. Create a metric in the <a href="https://activitysmith.com/app/widgets" target="_blank" rel="noopener noreferrer">web app</a>, then update the metric value using our API, add a widget to your lock screen and it will fetch the latest update automatically.

<p align="center">
  <img src="https://cdn.activitysmith.com/features/create-widget-metric.png" alt="Create widget metric" width="680" />
</p>

Use the metric key to update its value.

```bash
activitysmith metrics update deploy.success_rate 99.9
```

String metric values work too.

```bash
activitysmith metrics update prod.status healthy
```

## Aliases

The CLI installs two bin names:

- `activitysmith` (recommended)
- `activitysmith-cli` (alias)

## Content State Options

For `activity stream|start|update|end|end-stream`, you can pass content state via JSON:

- `--content-state <json>`
- `--content-state-file <path>`

For `metrics` and `stats`, you can also pass the metrics array directly:

- `--metrics <json-array>`
- `--metrics-file <path>`

Or use flags to build the rest of the payload:

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

Live Activity action options:

- `--action <json>`
- `--action-file <path>`

Targeting options:

- `--channels <comma-separated-slugs>` (for `push`, `activity stream`, and `activity start`)

Widget metric options:

- `activitysmith metrics update <metric-key> <value>`
- `activitysmith metric update <metric-key> <value>` (alias)

Required fields:

- `activity stream`: `--title`, `--type`, plus `--metrics`, `--number-of-steps` and `--current-step`, `--percentage`, or `--value` with `--upper-limit`
- `activity start`: `--title`, `--type`, plus `--metrics`, `--number-of-steps` and `--current-step`, `--percentage`, or `--value` with `--upper-limit`
- `activity update`: `--title`, plus `--metrics`, `--current-step`, `--percentage`, or `--value` with `--upper-limit`
- `activity end`: `--title`, plus `--metrics`, `--current-step`, `--percentage`, or `--value` with `--upper-limit`
- `activity end-stream`: no content state is required, but if you provide one it follows the same rules as `activity end`

## Output

Use `--json` for machine-readable output.

```bash
activitysmith push --title "Hello" --json
```
