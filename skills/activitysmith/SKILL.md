---
name: activitysmith
description: Send ActivitySmith push notifications and drive Live Activity start/update/end lifecycle from any agent. Use when a task asks for alerts, progress updates, completion notifications, or Live Activity lifecycle operations.
---

# ActivitySmith

Use this skill to send push notifications and run Live Activity lifecycle commands.

## Preconditions

1. `activitysmith` CLI available in `PATH`.
2. `ACTIVITYSMITH_API_KEY` set in shell, or in `skills/activitysmith/.env`.

## Intent to Command Map

- Send push notification:
  `./skills/activitysmith/scripts/send_push.sh -m "..." [-t "..."] [-s "..."] [-c "..."] [-r "https://..."] [-a '[...]' | -A /path/actions.json]`
- Start Live Activity:
  `./skills/activitysmith/scripts/start_activity.sh --title "..." --type "segmented_progress" --steps N --current N [--subtitle "..."] [--color "..."] [--step-color "..."] [-c "..."] [--id-only]`
- Update Live Activity:
  `./skills/activitysmith/scripts/update_activity.sh --activity-id "..." --title "..." --current N [--subtitle "..."] [--type "..."] [--steps N]`
- End Live Activity:
  `./skills/activitysmith/scripts/end_activity.sh --activity-id "..." --title "..." --current N [--subtitle "..."] [--auto-dismiss N]`

## Push Rules

- Minimal push: `title` + `message`.
- Optional targeting: `-c "channel-a,channel-b"`.
- Optional tap redirection: `-r "https://..."`.
- Optional long-press actions:
  - inline JSON: `-a '[{"title":"...","type":"open_url","url":"https://..."}]'`
  - file JSON: `-A ./actions.json`
- Actions constraints:
  - max 4 actions
  - each action requires `title`, `type`, `url`
  - `type` must be `open_url` or `webhook`
  - `url` must be `https://`
  - `method`/`body` valid only for `webhook`

## Live Activity Lifecycle Protocol

When user asks for ongoing progress updates:

1. Start activity once; capture returned Activity ID.
2. Update same Activity ID at meaningful milestones.
3. End same Activity ID when work completes or is blocked.
4. Never call update/end without a valid ID from start.

Use `start_activity.sh --id-only` when scripting chained calls.

## Examples

Basic push:

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Build Failed 🚨" \
  -m "CI pipeline failed on main branch"
```

Push with redirection and actions:

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Build Failed 🚨" \
  -m "CI pipeline failed on main branch" \
  -r "https://github.com/org/repo/actions/runs/123456789" \
  -a '[{"title":"Open Failing Run","type":"open_url","url":"https://github.com/org/repo/actions/runs/123456789"},{"title":"Create Incident","type":"webhook","url":"https://hooks.example.com/incidents/create","method":"POST","body":{"service":"payments-api","severity":"high"}}]'
```

Live Activity lifecycle:

```bash
activity_id="$(./skills/activitysmith/scripts/start_activity.sh \
  --title "Release deployment" \
  --subtitle "Preparing rollout" \
  --type "segmented_progress" \
  --steps 3 \
  --current 1 \
  --id-only)"

./skills/activitysmith/scripts/update_activity.sh \
  --activity-id "$activity_id" \
  --title "Release deployment" \
  --subtitle "Rolling out services" \
  --current 2

./skills/activitysmith/scripts/end_activity.sh \
  --activity-id "$activity_id" \
  --title "Release deployment" \
  --subtitle "Deployment complete" \
  --current 3 \
  --auto-dismiss 2
```
