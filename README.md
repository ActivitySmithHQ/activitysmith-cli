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

## Usage

```bash
activitysmith --help
```

### Send Push Notification

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch"
```

### Start Live Activity

```bash
activitysmith activity start \
  --content-state '{"title":"Deploy","subtitle":"start","numberOfSteps":4,"currentStep":1,"type":"segmented_progress","color":"yellow"}' \
  --channels "devs,ops"
```

Or use flags:

```bash
activitysmith activity start \
  --title "Deploy" \
  --subtitle "start" \
  --number-of-steps 4 \
  --current-step 1 \
  --type segmented_progress \
  --color yellow \
  --channels "devs,ops"
```

### Update Live Activity

```bash
activitysmith activity update \
  --activity-id "<activityId>" \
  --content-state '{"title":"Deploy","subtitle":"step 2","currentStep":2}'
```

Or use flags:

```bash
activitysmith activity update \
  --activity-id "<activityId>" \
  --title "Deploy" \
  --subtitle "step 2" \
  --current-step 2
```

### End Live Activity

```bash
activitysmith activity end \
  --activity-id "<activityId>" \
  --content-state '{"title":"Deploy","subtitle":"done","currentStep":4,"autoDismissMinutes":3}'
```

Or use flags:

```bash
activitysmith activity end \
  --activity-id "<activityId>" \
  --title "Deploy" \
  --subtitle "done" \
  --current-step 4 \
  --auto-dismiss-minutes 3
```

### Channels

Channels are used to target specific team members or devices. Can be used for both push notifications and live activities.

```bash
activitysmith push \
  --title "Build Failed 🚨" \
  --message "CI pipeline failed on main branch" \
  --channels "devs,ops"
```

### Push Notification Redirection and Actions

Push notification redirection and actions are optional and can be used to redirect the user to a specific URL when they tap the notification or to trigger a specific action when they long-press the notification.
Webhooks are executed by ActivitySmith backend.

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

### JSON Output

```bash
activitysmith push --title "Hello" --json
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
- `--color <color>`
- `--step-color <color>`
- `--auto-dismiss-minutes <number>`

Targeting options:

- `--channels <comma-separated-slugs>` (for `push` and `activity start`)

Required fields:

- `activity start`: `title`, `numberOfSteps`, `currentStep`, `type`
- `activity update`: `title`, `currentStep`
- `activity end`: `title`, `currentStep`

## Output

Use `--json` for machine-readable output.
