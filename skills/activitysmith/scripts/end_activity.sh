#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  end_activity.sh -a "activity_id" -t "title" --current <n> [--type "segmented_progress"] [--steps <n>] [-s "subtitle"] [--color "color"] [--step-color "color"] [--auto-dismiss <minutes>]
  end_activity.sh -a "activity_id" -t "title" [--type "progress"] [--percentage <n> | --value <n> --upper-limit <n>] [-s "subtitle"] [--color "color"] [--auto-dismiss <minutes>]

Required:
  -a, --activity-id  Activity ID returned by start_activity.sh
  -t, --title        Live Activity title

Optional:
  --type             Content state type: segmented_progress or progress
  --steps            Number of steps (segmented_progress)
  --current          Current step (segmented_progress)
  --percentage       Percentage progress (progress)
  --value            Current value (progress; use with --upper-limit)
  --upper-limit      Maximum value (progress; use with --value)
  -s, --subtitle     Subtitle
  --color            Accent color
  --step-color       Step color (segmented_progress)
  --auto-dismiss     Auto dismiss minutes
USAGE
}

activity_id=""
title=""
subtitle=""
type=""
steps=""
current=""
percentage=""
value=""
upper_limit=""
color=""
step_color=""
auto_dismiss=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--activity-id) activity_id="$2"; shift 2 ;;
    -t|--title) title="$2"; shift 2 ;;
    -s|--subtitle) subtitle="$2"; shift 2 ;;
    --type) type="$2"; shift 2 ;;
    --steps) steps="$2"; shift 2 ;;
    --current) current="$2"; shift 2 ;;
    --percentage) percentage="$2"; shift 2 ;;
    --value) value="$2"; shift 2 ;;
    --upper-limit) upper_limit="$2"; shift 2 ;;
    --color) color="$2"; shift 2 ;;
    --step-color) step_color="$2"; shift 2 ;;
    --auto-dismiss) auto_dismiss="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$activity_id" || -z "$title" ]]; then
  echo "Missing required options."
  usage
  exit 1
fi

has_segmented="false"
has_progress="false"
if [[ -n "$current" || -n "$steps" || -n "$step_color" ]]; then
  has_segmented="true"
fi
if [[ -n "$percentage" || -n "$value" || -n "$upper_limit" ]]; then
  has_progress="true"
fi

if [[ "$has_segmented" == "true" && "$has_progress" == "true" ]]; then
  echo "Do not mix segmented_progress fields with progress fields."
  usage
  exit 1
fi

if [[ -n "$type" && "$type" != "segmented_progress" && "$type" != "progress" ]]; then
  echo "--type must be segmented_progress or progress."
  usage
  exit 1
fi

if [[ "$type" == "segmented_progress" || ( -z "$type" && "$has_segmented" == "true" ) ]]; then
  if [[ -z "$current" ]]; then
    echo "segmented_progress end requires --current."
    usage
    exit 1
  fi
fi

if [[ "$type" == "progress" || ( -z "$type" && "$has_progress" == "true" ) ]]; then
  if [[ -n "$percentage" && ( -n "$value" || -n "$upper_limit" ) ]]; then
    echo "Use either --percentage or --value with --upper-limit."
    usage
    exit 1
  fi
  if [[ -z "$percentage" && ( -z "$value" || -z "$upper_limit" ) ]]; then
    echo "progress end requires --percentage, or --value with --upper-limit."
    usage
    exit 1
  fi
fi

if [[ -z "$type" && "$has_segmented" == "false" && "$has_progress" == "false" ]]; then
  echo "Provide segmented_progress fields or progress fields."
  usage
  exit 1
fi

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_env_if_present
require_api_key
require_cli

cmd=(
  activity end
  --activity-id "$activity_id"
  --title "$title"
)

if [[ -n "$subtitle" ]]; then
  cmd+=(--subtitle "$subtitle")
fi
if [[ -n "$type" ]]; then
  cmd+=(--type "$type")
fi
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
if [[ -n "$color" ]]; then
  cmd+=(--color "$color")
fi
if [[ -n "$step_color" ]]; then
  cmd+=(--step-color "$step_color")
fi
if [[ -n "$auto_dismiss" ]]; then
  cmd+=(--auto-dismiss-minutes "$auto_dismiss")
fi

run_activitysmith "${cmd[@]}"
