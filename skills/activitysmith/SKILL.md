---
name: activitysmith
description: Send ActivitySmith Push Notifications, set App Icon Badge Counts, include notification taps or actions that run a specific iPhone Shortcut, and manage Live Activities from coding agents through the ActivitySmith CLI.
---

# ActivitySmith

Use this skill when the user wants an iPhone/iPad signal from an agent:

- "notify me when done"
- "send me a push notification"
- "open this Shortcut when I tap the notification"
- "open ChatGPT when I tap the notification"
- "keep progress visible while you work"
- "show this metric on my Lock Screen"
- "tell me if you get blocked"

The CLI is the tool. This skill is the intent mapping and recipe layer.

## Requirements

- `activitysmith` must be available in `PATH`.
- `ACTIVITYSMITH_API_KEY` must be set in the shell or in `skills/activitysmith/.env`.
- Use bundled scripts from `./skills/activitysmith/scripts/` when available.
- Use direct `activitysmith ...` commands for simple one-liners or widget metrics.
- Examples below assume the skill is installed at `./skills/activitysmith`. If not, replace that prefix with the actual skill directory.

If auth is missing, tell the user to set:

```bash
export ACTIVITYSMITH_API_KEY="..."
```

## Pick The Right Signal

- Push Notification: one important event, completion, blocker, review request, or handoff.
- Push Notification with redirection: tapping the notification should open a URL or run a specific Shortcut that already exists on the user's iPhone.
- Push Notification with actions: long-press should show up to 4 buttons.
- Live Activity: progress should stay visible while work is ongoing.
- Widget metric: one stable value should stay visible after the task ends.
- Channels: only specific teammates/devices should receive the update.

Default to a Push Notification for "notify me when done." Use a Live Activity only when the user asks for progress or the task is long-running enough that progress updates matter.

## URL And Action Rules

- `redirection` / `--redirection`: opens when the notification is tapped.
- `open_url` action: opens an HTTPS URL or runs a specific iPhone Shortcut with a `shortcuts://run-shortcut?name=...` URL.
- `webhook` action: ActivitySmith backend calls an HTTPS endpoint.
- `media` must be HTTPS and cannot be combined with actions.
- Keep action labels short. iOS buttons have limited space.
- Live Activities support one action button. Push Notifications support up to 4 actions.
- Encode Shortcut names with spaces: `Open Jarvis` becomes `Open%20Jarvis`.

## Recipes

### Notify When Done

Use this when the user says "notify me when done" or when a long task completes.

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Task finished" \
  -m "Your agent finished the task."
```

### Notify With A Shortcut Tap Target

Use this when tapping the notification should run a specific Shortcut that already exists on the user's iPhone.

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Task finished" \
  -m "Tap to run Test." \
  -r "shortcuts://run-shortcut?name=Test"
```

### Notify And Open ChatGPT On Tap

Use this when the user wants to continue with a coding agent from the ChatGPT app on iPhone. The Shortcut must already exist on the user's iPhone and should open the ChatGPT app.

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Input needed" \
  -m "Tap to continue in ChatGPT." \
  -r "shortcuts://run-shortcut?name=OpenChatGPT"
```

### Notify With Action Buttons

Use this when the notification should offer multiple follow-up actions.

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Build failed" \
  -m "CI failed on main." \
  -a '[{"title":"Open Run","type":"open_url","url":"https://github.com/acme/web/actions/runs/123456789"},{"title":"Chat with Jarvis","type":"open_url","url":"shortcuts://run-shortcut?name=Jarvis"}]'
```

### Send A Rich Push With A Tap Target

Use this when the notification should preview an image, audio file, or video.

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Preview ready" \
  -m "Open the generated screenshot." \
  -M "https://cdn.example.com/output/homepage.png" \
  -r "https://github.com/acme/web/pull/482"
```

### Start, Update, And End A Live Activity

Use this when progress should stay visible.

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

### Add A Shortcut Button To A Live Activity

Use this when tapping a Live Activity button should run a specific iPhone Shortcut or open a local app through a Shortcut.

```bash
./skills/activitysmith/scripts/start_activity.sh \
  --title "Deploying payments-api" \
  --subtitle "Running migrations" \
  --type "segmented_progress" \
  --steps 5 \
  --current 3 \
  --action '{"title":"Chat with Jarvis","type":"open_url","url":"shortcuts://run-shortcut?name=Jarvis"}'
```

### Ask For Review Or Report A Blocker

Use this when the agent needs human input.

```bash
./skills/activitysmith/scripts/send_push.sh \
  -t "Input needed" \
  -m "I hit a blocker and need your decision."
```

### Update A Widget Metric

Use this when a stable metric should stay visible on the Lock Screen.

```bash
activitysmith metrics update deploy.success_rate 99.9
```

String values work too:

```bash
activitysmith metrics update prod.status healthy
```

## App Icon Badge Count

Use this when a number should stay visible on the ActivitySmith app icon.

```bash
activitysmith badge 8333
```

Pass `0` to clear the badge. Use `--channels` to target specific team members or devices.

```bash
activitysmith badge 3 --channels "sales,customer-success"
```

## Agent Behavior

- Be sparse. Send signals at meaningful moments, not every small step.
- Use clear human titles: "Task finished", "Input needed", "Build failed".
- Mention the concrete next step in the message.
- For Shortcut taps, use `--redirection`.
- For Shortcut buttons, use an `open_url` action with a `shortcuts://` URL.
- For long-running progress, start one Live Activity, update it, then end it.
- Capture the Activity ID when using start/update/end.
- Do not expose API keys, tokens, or secrets in titles, messages, action URLs, or webhook bodies.
- If a command fails, report the error and do not retry repeatedly without a change.
