#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: update_activity.sh -a "activity_id" -t "title" --current <n> [--type "type"] [--steps <n>] [-s "subtitle"] [--color "color"] [--step-color "color"]

Required:
  -a, --activity-id  Activity ID returned by start_activity.sh
  -t, --title        Live Activity title
  --current          Current step

Optional:
  --type             Content state type
  --steps            Number of steps
  -s, --subtitle     Subtitle
  --color            Accent color
  --step-color       Step color
USAGE
}

activity_id=""
title=""
subtitle=""
type=""
steps=""
current=""
color=""
step_color=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--activity-id) activity_id="$2"; shift 2 ;;
    -t|--title) title="$2"; shift 2 ;;
    -s|--subtitle) subtitle="$2"; shift 2 ;;
    --type) type="$2"; shift 2 ;;
    --steps) steps="$2"; shift 2 ;;
    --current) current="$2"; shift 2 ;;
    --color) color="$2"; shift 2 ;;
    --step-color) step_color="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$activity_id" || -z "$title" || -z "$current" ]]; then
  echo "Missing required options."
  usage
  exit 1
fi

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_env_if_present
require_api_key
require_cli

cmd=(
  activity update
  --activity-id "$activity_id"
  --title "$title"
  --current-step "$current"
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
if [[ -n "$color" ]]; then
  cmd+=(--color "$color")
fi
if [[ -n "$step_color" ]]; then
  cmd+=(--step-color "$step_color")
fi

run_activitysmith "${cmd[@]}"
