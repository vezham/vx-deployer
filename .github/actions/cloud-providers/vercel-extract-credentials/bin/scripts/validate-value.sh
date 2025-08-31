#!/bin/bash

# @vx/NOTE: to validate JSON values
validate_value() {
    local value=$1
    local name=$2
    
    if [ "$value" = "null" ] || [ -z "$value" ]; then
        echo "@vx/ERROR: $name not found in token file"
        return 1
    fi

    return 0
}
