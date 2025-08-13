#!/bin/bash

check_dependencies() {
    local ns_npm="NPM"

    # check if jq command exists
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        exit 1
    fi

    # check NPM authentication...
    log_info "check NPM auth...: @$(echo $(npm whoami))" $ns_npm

    if ! npm whoami &> /dev/null; then
        log_error "Not logged into npm. Please run 'npm login' first." $ns_npm
        exit 1
    fi
}

pre_setup(){
    # Set strict mode, error handling
    set -uo pipefail # set -euo pipefail
    trap cleanup EXIT # trap cleanup SIGINT SIGTERM EXIT

    # Initialize logging
    setup_logging
    check_dependencies
}

cleanup() {
    do_cleanup
    log_info "Full logs available at → $LOG_FILE"
}

# ------ MODULE BASED COMMON UTILS ------

do_cleanup() {
    log_info "Executing MODULE cleanup!..."
    # if [ -f "$CHANGESET_STATUS_JSON" ]; then
    #     rm "$CHANGESET_STATUS_JSON"
    # fi
}