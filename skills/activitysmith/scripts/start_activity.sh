#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  start_activity.sh -t "title" --type "segmented_progress" --steps <n> --current <n> [-s "subtitle"] [-c "channels"] [--color "color"] [--step-color "color"] [--action '<json>' | --action-file /path/action.json] [--id-only]
  start_activity.sh -t "title" --type "progress" [--percentage <n> | --value <n> --upper-limit <n>] [-s "subtitle"] [-c "channels"] [--color "color"] [--action '<json>' | --action-file /path/action.json] [--id-only]

Required:
  -t, --title       Live Activity title
  --type            Content state type: segmented_progress or progress

Optional:
  --steps           Number of steps (segmented_progress)
  --current         Current step (segmented_progress)
  --percentage      Percentage progress (progress)
  --value           Current value (progress; use with --upper-limit)
  --upper-limit     Maximum value (progress; use with --value)
  -s, --subtitle    Subtitle
  -c, --channels    Comma-separated channel slugs
  --color           Accent color
  --step-color      Step color (segmented_progress)
  --action          Live Activity action JSON object
  --action-file     Path to Live Activity action JSON file
  --id-only         Print only the Activity ID from command output
USAGE
}

title=""
subtitle=""
channels=""
type=""
steps=""
current=""
percentage=""
value=""
upper_limit=""
color=""
step_color=""
action_json=""
action_file=""
id_only="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--title) title="$2"; shift 2 ;;
    -s|--subtitle) subtitle="$2"; shift 2 ;;
    -c|--channels) channels="$2"; shift 2 ;;
    --type) type="$2"; shift 2 ;;
    --steps) steps="$2"; shift 2 ;;
    --current) current="$2"; shift 2 ;;
    --percentage) percentage="$2"; shift 2 ;;
    --value) value="$2"; shift 2 ;;
    --upper-limit) upper_limit="$2"; shift 2 ;;
    --color) color="$2"; shift 2 ;;
    --step-color) step_color="$2"; shift 2 ;;
    --action) action_json="$2"; shift 2 ;;
    --action-file) action_file="$2"; shift 2 ;;
    --id-only) id_only="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$title" || -z "$type" ]]; then
  echo "Missing required options."
  usage
  exit 1
fi
if [[ -n "$action_json" && -n "$action_file" ]]; then
  echo "Provide either --action or --action-file, not both."
  usage
  exit 1
fi

if [[ "$type" == "segmented_progress" ]]; then
  if [[ -z "$steps" || -z "$current" ]]; then
    echo "segmented_progress requires --steps and --current."
    usage
    exit 1
  fi
  if [[ -n "$percentage" || -n "$value" || -n "$upper_limit" ]]; then
    echo "Do not mix progress fields with segmented_progress."
    usage
    exit 1
  fi
elif [[ "$type" == "progress" ]]; then
  if [[ -n "$steps" || -n "$current" || -n "$step_color" ]]; then
    echo "Do not mix segmented_progress fields with progress."
    usage
    exit 1
  fi
  if [[ -n "$percentage" && ( -n "$value" || -n "$upper_limit" ) ]]; then
    echo "Use either --percentage or --value with --upper-limit."
    usage
    exit 1
  fi
  if [[ -z "$percentage" && ( -z "$value" || -z "$upper_limit" ) ]]; then
    echo "progress requires --percentage, or --value with --upper-limit."
    usage
    exit 1
  fi
else
  echo "--type must be segmented_progress or progress."
  usage
  exit 1
fi

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_env_if_present
require_api_key
require_cli

cmd=(
  activity start
  --title "$title"
  --type "$type"
)

if [[ -n "$steps" ]]; then
  cmd+=(--number-of-steps "$steps")
fi
if [[ -n "$current" ]]; then
  cmd+=(--current-step "$current")
fi
if [[ -n "$percentage" ]]; then
  cmd+=(--percentage "$percentage")
fi
if [[ -n "$value" ]]; then
  cmd+=(--value "$value")
fi
if [[ -n "$upper_limit" ]]; then
  cmd+=(--upper-limit "$upper_limit")
fi

if [[ -n "$subtitle" ]]; then
  cmd+=(--subtitle "$subtitle")
fi
if [[ -n "$channels" ]]; then
  cmd+=(--channels "$channels")
fi
if [[ -n "$color" ]]; then
  cmd+=(--color "$color")
fi
if [[ -n "$step_color" ]]; then
  cmd+=(--step-color "$step_color")
fi
if [[ -n "$action_json" ]]; then
  cmd+=(--action "$action_json")
fi
if [[ -n "$action_file" ]]; then
  cmd+=(--action-file "$action_file")
fi

if [[ "$id_only" == "true" ]]; then
  output="$(run_activitysmith --json "${cmd[@]}")"
  activity_id="$(
    printf '%s\n' "$output" | node -e '
      const fs = require("fs");
      const input = fs.readFileSync(0, "utf8");
      try {
        const parsed = JSON.parse(input);
        const id = parsed?.activityId ?? parsed?.activity_id ?? "";
        if (typeof id === "string" && id.length > 0) {
          process.stdout.write(id);
        }
      } catch {}
    '
  )"
  if [[ -z "$activity_id" ]]; then
    echo "Could not parse Activity ID from JSON output." >&2
    echo "$output" >&2
    exit 1
  fi
  printf '%s\n' "$activity_id"
  exit 0
fi

output="$(run_activitysmith "${cmd[@]}")"
printf '%s\n' "$output"
