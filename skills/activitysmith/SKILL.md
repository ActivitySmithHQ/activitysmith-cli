---

## name: activitysmith

description: Send ActivitySmith Push Notifications and run Live Activity start/update/end lifecycle from coding agents through the bundled ActivitySmith CLI scripts. Use when an agent should send milestone, blocker, review, or completion alerts to iPhone or iPad, or keep long-running work visible step by step with Live Activities.

# ActivitySmith

Use this skill to let Codex, Claude, or any skills-compatible agent send:

- Push Notifications for milestone, blocker, review, and completion alerts
- Live Activities for step-by-step status during long-running work

Install the ActivitySmith skill, then tell your agent like Claude or Codex to keep you updated while it works. It can send Push Notifications for milestone, blocker, and completion alerts, and use Live Activities for step-by-step status on your iOS device(s) during long-running tasks.

## Requirements

- Ensure `activitysmith` is available in `PATH`
- Set `ACTIVITYSMITH_API_KEY` in the shell, or in `skills/activitysmith/.env`
- Use the bundled scripts in `./skills/activitysmith/scripts/`
- Run any bundled script with `-h` when you need the full flag reference

## Choose The Right Signal

- Use a Push Notification when one alert is enough
- Use a Live Activity when work will move through stages or progress over time
- Use channels when only some devices or teammates should receive the update
- Prefer concise human copy: short title, concrete subtitle, clear message

## Push Notifications

Use Push Notifications for one-off alerts.

Choose one of these patterns:

- Use a basic push for milestone, blocker, or completion updates
- Use a rich push when the notification should preview an image, audio file, or video
- Use an actionable push when someone should be able to open a URL or trigger a webhook from the notification

### Send A Basic Push Notification

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Build Failed" \
  -m "CI pipeline failed on main branch"
```

### Send A Rich Push Notification

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Homepage ready" \
  -m "Your agent finished the redesign." \
  -M "https://cdn.example.com/output/homepage-v2.png" \
  -r "https://github.com/acme/web/pull/482"
```

### Send An Actionable Push Notification

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Build Failed" \
  -m "CI pipeline failed on main branch" \
  -r "https://github.com/org/repo/actions/runs/123456789" \
  -a '[{"title":"Open Failing Run","type":"open_url","url":"https://github.com/org/repo/actions/runs/123456789"},{"title":"Create Incident","type":"webhook","url":"https://hooks.example.com/incidents/create","method":"POST","body":{"service":"payments-api","severity":"high"}}]'
```

### Follow These Push Rules

- Use `-c "channel-a,channel-b"` to target specific channels
- Use `-M` only with an `https://` media URL
- Combine `-M` with `-r` when preview and tap destination should differ
- Never combine `-M` with `-a` or `-A`
- Keep actions to 4 or fewer
- Use `open_url` or `webhook` for action type
- Prefer `-A /path/to/actions.json` when actions get long

## Live Activities

Use Live Activities for ongoing work.

Follow the same lifecycle every time:

1. Start the activity once
2. Capture the returned Activity ID
3. Update the same Activity ID at meaningful milestones
4. End the same Activity ID when work finishes or stops

### Pick A Live Activity Type

- Use `segmented_progress` for jobs tracked in stages or steps
- Use `progress` for jobs tracked as a percentage or numeric range

### Start, Update, And End A Segmented Live Activity

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

### Start, Update, And End A Progress Live Activity

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

### Follow These Live Activity Rules

- Use `--id-only` on start when chaining commands
- Use `--steps` and `--current` for `segmented_progress`
- Use `--percentage`, or `--value` with `--upper-limit`, for `progress`
- Use `--action` or `--action-file` when the Live Activity should open a URL or trigger a webhook
- Never mix segmented and progress fields in the same command
- Never call update or end without a valid Activity ID from start

### Add A Live Activity Action

```bash
activity_id="$(./skills/activitysmith/scripts/start_activity.sh \
  --title "Deploying payments-api" \
  --subtitle "Running database migrations" \
  --type "segmented_progress" \
  --steps 5 \
  --current 3 \
  --action '{"title":"Open Workflow","type":"open_url","url":"https://github.com/acme/payments-api/actions/runs/1234567890"}' \
  --id-only)"

./skills/activitysmith/scripts/update_activity.sh \
  --activity-id "$activity_id" \
  --title "Reindexing product search" \
  --subtitle "Shard 7 of 12" \
  --steps 12 \
  --current 7 \
  --action '{"title":"Pause Reindex","type":"webhook","url":"https://ops.example.com/hooks/search/reindex/pause","method":"POST","body":{"job_id":"reindex-2026-03-19"}}'
```

## Default Agent Behavior

- Send a Push Notification for blockers, completion, review requests, or any single important event
- Start a Live Activity when the user wants visible progress during a long-running task
- Update a Live Activity only when progress meaningfully changes
- End the Live Activity when the task is done, paused, blocked, or handed off
- Prefer Push Notifications with media for screenshots, preview images, videos, or audio
- Prefer actionable Push Notifications when the user should be able to open a link or trigger follow-up directly from the notification
