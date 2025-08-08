#!/bin/bash

# Initialize logging
setup_logging() {
    mkdir -p "$LOG_DIR"
    touch "$LOG_FILE"

    echo -e "${GREEN} @vx/cli ${RED}${V_NS}${NC} Executing setup_logging..."
    log_info "Log file created at $LOG_FILE" "LOGGER"
}

# Logging functions
log() {
    local level=$1
    local message=$2
    local ns=${3:-'unknown'}
    local timestamp=$(date +'%Y-%m-%d %H:%M:%S')
    local log_console="[vezham] [$timestamp] [$ns]: "
    local log_message="[vezham] [$timestamp] [$level] [$ns]: $message"

    # Log to console
    if [ "$level" = "INFO" ]; then
        echo -e "${GREEN}$level: $log_console${NC}$message"
    elif [ "$level" = "WARN" ]; then
        echo -e "${YELLOW}$level: $log_console${NC}$message"
    elif [ "$level" = "DEBUG" ]; then
        echo -e "${BLUE}$level: $log_console${NC}$message"
    elif [ "$level" = "ERROR" ]; then
        echo -e "${RED}$level: $log_console${NC}$message" >&2
    else
        echo -e "${NC}LOG: $log_console${NC}$message"
    fi
  
    # Log to file
    echo "$log_message" >> "$LOG_FILE"
}

log_info() { log "INFO" "$1" "${2:-$V_NS}"; }
log_warn() { log "WARN" "$1" "${2:-$V_NS}"; }
log_debug() { log "DEBUG" "$1" "${2:-$V_NS}"; }
log_error() { log "ERROR" "$1" "${2:-$V_NS}"; }
