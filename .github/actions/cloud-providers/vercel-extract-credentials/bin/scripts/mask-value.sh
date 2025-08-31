#!/bin/bash

# @vx/NOTE: to mask values
mask_value() {
    local value=$1
    local name=$2
    
    if [ "$value" = "null" ] || [ -z "$value" ]; then
        echo "@vx/ERROR: Invalid $name value"
        return 1
    fi
    
    echo "::add-mask::$value"
    return 0
}
