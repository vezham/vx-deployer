#!/bin/bash

# Configuration | $V
readonly V_HOME_DIR=".vezham"
readonly V_NS='@vx/ci'

# Configuration | LOGS
readonly LOG_DIR="${V_HOME_DIR}/logs"
readonly LOG_FILE="${LOG_DIR}/release-$(date +'%Y%m%d-%H%M%S').log"

# Colors for output
RED='\033[1;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration | GIT variables # wjdlz/TODO: set v0x-bot
readonly GIT_BOT_EMAIL="github-actions[bot]@users.noreply.github.com"
readonly GIT_BOT_NAME="github-actions[bot]"
readonly GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# ------ MODULE BASED CONFIG ------

# Configuration variables
BATCH_SIZE=10   # Number of packages to publish in each batch
BATCH_DELAY=10   #[300] # Delay between batches in seconds (5 minutes)
PACKAGE_DELAY=3 #[5] Delay between individual packages in seconds 

# Status file
readonly CHANGESET_STATUS_JSON="${V_HOME_DIR}/op-release.json"
readonly RELEASE_FAILED_JSON="${V_HOME_DIR}/op-release-failed.json"
