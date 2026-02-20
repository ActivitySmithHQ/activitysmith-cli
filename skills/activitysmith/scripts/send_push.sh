#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: send_push.sh -m "message" [-t "title"] [-s "subtitle"] [-c "channels"]

Required:
  -m  Push message

Optional:
  -t  Push title (default: "Codex task finished")
  -s  Push subtitle
  -c  Comma-separated channel slugs (example: "devs,ops")
USAGE
}

message=""
title="Codex task finished"
subtitle=""
channels=""

while getopts ":m:t:s:c:h" opt; do
  case "$opt" in
    m) message="$OPTARG" ;;
    t) title="$OPTARG" ;;
    s) subtitle="$OPTARG" ;;
    c) channels="$OPTARG" ;;
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

run_activitysmith "${cmd[@]}"
