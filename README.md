# ActivitySmith CLI

CLI wrapper for the ActivitySmith API using the official Node SDK.

## Install

```bash
npm install -g activitysmith-cli
```

## Auth

Set `ACTIVITYSMITH_API_KEY` or pass `--api-key`.

## Usage

```bash
activitysmith --help
```

### Send Push Notification

```bash
activitysmith push \
  --title "Build Failed" \
  --message "CI pipeline failed on main branch" \
  --channels "devs,ops"
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
