#!/bin/bash

# wjdlz/NOTE: Source all required scripts by DIR
source "$(dirname "$0")/index.sh"

# $token_file (extract credentials from token.json file)
# $output_file (o/p to github actions)
# $1 - token_file 
# $2 - output_file 

token_file=$1
output_file=$2

if [ ! -f "$token_file" ]; then
    echo "Error: Token file not found"
    exit 1
fi

# extract all required values using jq
GCP_PROJECT_ID=$(jq -r '.project_id' "$token_file")

# Validate all values
validate_value "$GCP_PROJECT_ID" "GCP_PROJECT_ID" || exit 1

# Mask each credential
mask_value "$GCP_PROJECT_ID" "GCP_PROJECT_ID" || exit 1

echo "Credentials have been masked successfully"

# Write to GitHub output file
{
    echo "GCP_PROJECT_ID=$GCP_PROJECT_ID"
} >> "$output_file"
