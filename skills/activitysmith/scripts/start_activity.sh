#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: start_activity.sh -t "title" --type "type" --steps <n> --current <n> [-s "subtitle"] [-c "channels"] [--color "color"] [--step-color "color"]

Required:
  -t, --title       Live Activity title
  --type            Content state type (e.g. segmented_progress)
  --steps           Number of steps
  --current         Current step

Optional:
  -s, --subtitle    Subtitle
  -c, --channels    Comma-separated channel slugs
  --color           Accent color
  --step-color      Step color
USAGE
}

title=""
subtitle=""
channels=""
type=""
steps=""
current=""
color=""
step_color=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--title) title="$2"; shift 2 ;;
    -s|--subtitle) subtitle="$2"; shift 2 ;;
    -c|--channels) channels="$2"; shift 2 ;;
    --type) type="$2"; shift 2 ;;
    --steps) steps="$2"; shift 2 ;;
    --current) current="$2"; shift 2 ;;
    --color) color="$2"; shift 2 ;;
    --step-color) step_color="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$title" || -z "$type" || -z "$steps" || -z "$current" ]]; then
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
  activity start
  --title "$title"
  --type "$type"
  --number-of-steps "$steps"
  --current-step "$current"
)

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

run_activitysmith "${cmd[@]}"
