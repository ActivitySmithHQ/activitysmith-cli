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

# Accepts ACTIVITYSMITH_API_KEY or the sign-in saved by `activitysmith auth login`.
require_api_key() {
  if [[ -n "${ACTIVITYSMITH_API_KEY:-}" ]]; then
    return
  fi
  if command -v activitysmith >/dev/null 2>&1 &&
    activitysmith --json auth status 2>/dev/null | grep -q '"auth_source": "auth login"'; then
    return
  fi
  echo "Not signed in to ActivitySmith. Run: activitysmith auth login"
  echo "Or export ACTIVITYSMITH_API_KEY, or set it in skills/activitysmith/.env"
  exit 1
}

require_cli() {
  if ! command -v activitysmith >/dev/null 2>&1; then
    echo "activitysmith CLI not found in PATH. Install with: npm install -g activitysmith-cli"
    exit 1
  fi
}

run_activitysmith() {
  if [[ -n "${ACTIVITYSMITH_API_KEY:-}" ]]; then
    activitysmith --api-key "$ACTIVITYSMITH_API_KEY" "$@"
  else
    activitysmith "$@"
  fi
}
