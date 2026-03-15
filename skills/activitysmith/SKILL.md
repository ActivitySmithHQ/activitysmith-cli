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
  `./skills/activitysmith/scripts/send_push.sh -m "..." [-t "..."] [-s "..."] [-c "..."] [-M "https://..."] [-r "https://..."] [-a '[...]' | -A /path/actions.json]`
- Start Live Activity:
  - segmented: `./skills/activitysmith/scripts/start_activity.sh --title "..." --type "segmented_progress" --steps N --current N [--subtitle "..."] [--color "..."] [--step-color "..."] [-c "..."] [--id-only]`
  - progress: `./skills/activitysmith/scripts/start_activity.sh --title "..." --type "progress" [--subtitle "..."] [--percentage N | --value N --upper-limit N] [--color "..."] [-c "..."] [--id-only]`
- Update Live Activity:
  - segmented: `./skills/activitysmith/scripts/update_activity.sh --activity-id "..." --title "..." --current N [--subtitle "..."] [--type "segmented_progress"] [--steps N]`
  - progress: `./skills/activitysmith/scripts/update_activity.sh --activity-id "..." --title "..." [--subtitle "..."] [--type "progress"] [--percentage N | --value N --upper-limit N]`
- End Live Activity:
  - segmented: `./skills/activitysmith/scripts/end_activity.sh --activity-id "..." --title "..." --current N [--subtitle "..."] [--type "segmented_progress"] [--steps N] [--auto-dismiss N]`
  - progress: `./skills/activitysmith/scripts/end_activity.sh --activity-id "..." --title "..." [--subtitle "..."] [--type "progress"] [--percentage N | --value N --upper-limit N] [--auto-dismiss N]`

## Push Rules

- Minimal push: `title` + `message`.
- Optional targeting: `-c "channel-a,channel-b"`.
- Optional rich media: `-M "https://..."`.
- Optional tap redirection: `-r "https://..."`.
- Optional long-press actions:
  - inline JSON: `-a '[{"title":"...","type":"open_url","url":"https://..."}]'`
  - file JSON: `-A ./actions.json`
- Media constraints:
  - `media` must be `https://`
  - `media` can be combined with redirection
  - never combine `media` with actions
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

Quick type guide:

- `segmented_progress`: best for jobs tracked in steps
- `progress`: best for jobs tracked as a percentage or numeric range

Type rules:

- `segmented_progress`: use `--steps` and `--current`. `--steps` can change later.
- `progress`: use `--percentage`, or `--value` with `--upper-limit`.
- Never mix segmented and progress fields in the same command.

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

Rich push with media:

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Homepage ready" \
  -m "Your agent finished the redesign." \
  -M "https://cdn.example.com/output/homepage-v2.png" \
  -r "https://github.com/acme/web/pull/482"
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

Progress Live Activity lifecycle:

```bash
activity_id="$(./skills/activitysmith/scripts/start_activity.sh \
  --title "EV Charging" \
  --subtitle "Added 30 mi range" \
  --type "progress" \
  --percentage 15 \
  --id-only)"

./skills/activitysmith/scripts/update_activity.sh \
  --activity-id "$activity_id" \
  --title "EV Charging" \
  --subtitle "Added 120 mi range" \
  --percentage 60

./skills/activitysmith/scripts/end_activity.sh \
  --activity-id "$activity_id" \
  --title "EV Charging" \
  --subtitle "Added 200 mi range" \
  --percentage 100 \
  --auto-dismiss 2
```
