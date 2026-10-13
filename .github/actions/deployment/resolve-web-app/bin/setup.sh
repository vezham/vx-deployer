#!/usr/bin/env bash
set -euo pipefail

action_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$action_dir"
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts
