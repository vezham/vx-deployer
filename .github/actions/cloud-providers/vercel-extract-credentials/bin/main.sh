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
VERCEL_TOKEN=$(jq -r '.VERCEL_TOKEN' "$token_file")
VERCEL_ORG_ID=$(jq -r '.VERCEL_ORG_ID' "$token_file")
VERCEL_PROJECT_ID=$(jq -r '.VERCEL_PROJECT_ID' "$token_file")

# Validate all values
validate_value "$VERCEL_TOKEN" "VERCEL_TOKEN" || exit 1
validate_value "$VERCEL_ORG_ID" "VERCEL_ORG_ID" || exit 1
validate_value "$VERCEL_PROJECT_ID" "VERCEL_PROJECT_ID" || exit 1

# Mask each credential
mask_value "$VERCEL_TOKEN" "VERCEL_TOKEN" || exit 1
mask_value "$VERCEL_ORG_ID" "VERCEL_ORG_ID" || exit 1
mask_value "$VERCEL_PROJECT_ID" "VERCEL_PROJECT_ID" || exit 1

echo "Credentials have been masked successfully"

# Write to GitHub output file
{
    echo "VERCEL_TOKEN=$VERCEL_TOKEN"
    echo "VERCEL_ORG_ID=$VERCEL_ORG_ID"
    echo "VERCEL_PROJECT_ID=$VERCEL_PROJECT_ID"
} >> "$output_file"
