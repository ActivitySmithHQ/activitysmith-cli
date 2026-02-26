#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: send_push.sh -m "message" [-t "title"] [-s "subtitle"] [-c "channels"] [-r "redirection"] [-a "actions-json"] [-A "actions-file"]

Required:
  -m  Push message

Optional:
  -t  Push title (default: "ActivitySmith update")
  -s  Push subtitle
  -c  Comma-separated channel slugs (example: "devs,ops")
  -r  Redirection HTTPS URL (opened on notification tap)
  -a  Actions JSON array string (max 4 actions)
  -A  Path to actions JSON array file
USAGE
}

message=""
title="ActivitySmith update"
subtitle=""
channels=""
redirection=""
actions_json=""
actions_file=""

while getopts ":m:t:s:c:r:a:A:h" opt; do
  case "$opt" in
    m) message="$OPTARG" ;;
    t) title="$OPTARG" ;;
    s) subtitle="$OPTARG" ;;
    c) channels="$OPTARG" ;;
    r) redirection="$OPTARG" ;;
    a) actions_json="$OPTARG" ;;
    A) actions_file="$OPTARG" ;;
    h) usage; exit 0 ;;
    \?) echo "Unknown option: -$OPTARG"; usage; exit 1 ;;
    :) echo "Missing value for -$OPTARG"; usage; exit 1 ;;
  esac
done

if [[ -z "$message" ]]; then
  echo "Message is required."
  usage
  exit 1
fi

if [[ -n "$actions_json" && -n "$actions_file" ]]; then
  echo "Use either -a or -A, not both."
  usage
  exit 1
fi

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_env_if_present
require_api_key
require_cli

cmd=(push --title "$title" --message "$message")
if [[ -n "$subtitle" ]]; then
  cmd+=(--subtitle "$subtitle")
fi
if [[ -n "$channels" ]]; then
  cmd+=(--channels "$channels")
fi
if [[ -n "$redirection" ]]; then
  cmd+=(--redirection "$redirection")
fi
if [[ -n "$actions_json" ]]; then
  cmd+=(--actions "$actions_json")
fi
if [[ -n "$actions_file" ]]; then
  cmd+=(--actions-file "$actions_file")
fi

run_activitysmith "${cmd[@]}"
