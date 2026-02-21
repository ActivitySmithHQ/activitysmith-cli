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
  --title "New subscription 💸" \
  --message "Customer upgraded to Pro plan" \
  --channels "devs,ops"
```

### Start Live Activity

```bash
activitysmith activity start \
  --content-state '{"title":"Nightly database backup","subtitle":"create snapshot","numberOfSteps":3,"currentStep":1,"type":"segmented_progress","color":"yellow"}' \
  --channels "devs,ops"
```

Or use flags:

```bash
activitysmith activity start \
  --title "Nightly database backup" \
  --subtitle "create snapshot" \
  --number-of-steps 3 \
  --current-step 1 \
  --type segmented_progress \
  --color yellow \
  --channels "devs,ops"
```

### Update Live Activity

```bash
activitysmith activity update \
  --activity-id "<activityId>" \
  --content-state '{"title":"Nightly database backup","subtitle":"upload archive","currentStep":2}'
```

Or use flags:

```bash
activitysmith activity update \
  --activity-id "<activityId>" \
  --title "Nightly database backup" \
  --subtitle "upload archive" \
  --current-step 2
```

### End Live Activity

```bash
activitysmith activity end \
  --activity-id "<activityId>" \
  --content-state '{"title":"Nightly database backup","subtitle":"verify restore","currentStep":3,"autoDismissMinutes":2}'
```

Or use flags:

```bash
activitysmith activity end \
  --activity-id "<activityId>" \
  --title "Nightly database backup" \
  --subtitle "verify restore" \
  --current-step 3 \
  --auto-dismiss-minutes 2
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
