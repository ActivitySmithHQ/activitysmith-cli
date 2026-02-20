#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${script_dir}/../.env"

load_env_if_present() {
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$env_file"
    set +a
  fi
}

require_api_key() {
  if [[ -z "${ACTIVITYSMITH_API_KEY:-}" ]]; then
    echo "ACTIVITYSMITH_API_KEY is not set. Export it or set it in skills/activitysmith/.env"
    exit 1
  fi
}

require_cli() {
  if ! command -v activitysmith >/dev/null 2>&1; then
    echo "activitysmith CLI not found in PATH. Install with: npm install -g activitysmith-cli"
    exit 1
  fi
}

run_activitysmith() {
  activitysmith --api-key "$ACTIVITYSMITH_API_KEY" "$@"
}
