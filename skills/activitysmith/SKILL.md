---
name: activitysmith
description: Send ActivitySmith push notifications and manage Live Activities from any agent with the ActivitySmith CLI. Use when a task asks for push alerts, completion notifications, or Live Activity start/update/end lifecycle operations.
---

# ActivitySmith

Use this skill to send push notifications and drive Live Activity lifecycle commands.

## Workflow

1. Ensure `activitysmith-cli` is installed and `activitysmith` is in `PATH`.
2. Ensure `ACTIVITYSMITH_API_KEY` is set, or create `skills/activitysmith/.env` from `.env.example`.
3. Run one of the scripts in `scripts/`.
4. For Live Activities, save the `Activity ID` from `start_activity.sh` and pass it to `update_activity.sh` and `end_activity.sh`.

## Auth

`ACTIVITYSMITH_API_KEY` is required.

Scripts load auth in this order:
1. Existing shell environment
2. `skills/activitysmith/.env`

## Scripts

- `scripts/send_push.sh`: Send a push notification.
- `scripts/start_activity.sh`: Start a Live Activity and return an activity ID.
- `scripts/update_activity.sh`: Update an existing Live Activity.
- `scripts/end_activity.sh`: End an existing Live Activity.

## Quick Commands

```bash
./skills/activitysmith/scripts/send_push.sh -m "Build finished" -t "CI"
```

```bash
./skills/activitysmith/scripts/start_activity.sh \
  --title "Deploy" \
  --type "segmented_progress" \
  --steps 4 \
  --current 1
```

```bash
./skills/activitysmith/scripts/update_activity.sh \
  --activity-id "<activity_id>" \
  --title "Deploy" \
  --current 2
```

```bash
./skills/activitysmith/scripts/end_activity.sh \
  --activity-id "<activity_id>" \
  --title "Deploy" \
  --current 4 \
  --auto-dismiss 2
```
