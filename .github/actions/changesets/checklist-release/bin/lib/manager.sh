#!/bin/bash

do_publish() {
  local package_name=$1
  local new_version=$2
  local package_dir=$3
  local ns_npm="NPM"

  if [ ! -d "$package_dir" ]; then
    log_error "Directory not found: $package_dir"
    return 1
  fi

  # Check if package already exists
  if npm view "$package_name@$new_version" &>/dev/null; then
    log_warn "Package $package_name@$new_version already exists, skipping" $ns_npm
    return 1
  fi
  
  # verify DIST
  if [ ! -d "$package_dir/dist" ]; then
    (cd "$package_dir" && pnpm build)
    log_warn "init re-build dist for $package_name"
  fi

  # Attempt to log the dist 
  if ! (cd "$package_dir/dist" && pwd); then
    log_error "Unable to log dist $package_name" $ns_npm
    return 1
  fi
  
  log_debug "npm: @$(echo $(npm whoami))"
  log_debug "Publishing $package_name@$new_version → $package_dir" $ns_npm
  # Attempt to publish the package
  if ! (cd "$package_dir" && pnpm publish --provenance --access public --no-git-checks); then # --dry-run
    log_error "Unable to publish $package_name" $ns_npm
    return 1
  fi

  create_git_tag "$package_name" "$new_version"
  return 0
}

publish_packages_in_batches() {
  local total_packages=$1
  local packages_json=$(cat "$CHANGESET_STATUS_JSON")

  setup_git

  local batch_count=$(( ($total_packages + $BATCH_SIZE - 1) / $BATCH_SIZE ))
  log_info "Starting to publish $total_packages packages in $batch_count batches..."
  log_debug "CONFIG: Batch size=$BATCH_SIZE, Delay between batches=$BATCH_DELAY, packages=$PACKAGE_DELAY in seconds"

  local current=0
  local failed=0

  # Initialize failed packages JSON array
  echo "[]" > "$RELEASE_FAILED_JSON"

  # Process packages in batches
  batch_no=1
  for ((i = 0; i < total_packages; i += BATCH_SIZE)); do
    batch_end=$((i + BATCH_SIZE))
    [ $batch_end -gt $total_packages ] && batch_end=$total_packages
    
    log_info "Processing batch $batch_no of $batch_count (packages $((i+1)) to $batch_end of $total_packages)"
    
    # Process each package in the current batch
    for ((current = i; current < batch_end; current++)); do
      local package_info=$(echo "$packages_json" | jq -r ".[$current]")

      local package_name=$(echo "$package_info" | jq -r '.name')
      local new_version=$(echo "$package_info" | jq -r '.version')
      local package_dir=$(echo "$package_info" | jq -r '.directory')

      log_debug "Publishing $package_name ( $new_version → $current/$total_packages )"

      if ! do_publish "$package_name" "$new_version" "$package_dir"; then
        log_error "Failed to publish $package_name, continuing with next package"
        ((failed++))

        # Add failed package to JSON array
        local temp_json
        temp_json=$(jq ". + [{\"name\": \"$package_name\", \"version\": \"$new_version\", \"directory\": \"$package_dir\"}]" "$RELEASE_FAILED_JSON")
        echo "$temp_json" > "$RELEASE_FAILED_JSON"
        continue
      fi
      
      # Wait between publishes if there are more packages
      if [ $current -lt $((batch_end - 1)) ]; then
        log_info "Waiting $PACKAGE_DELAY seconds before next package..."
        sleep "$PACKAGE_DELAY"
      fi

    done
    
    # If this isn't the last batch, wait before processing the next batch
    if [ $batch_end -lt $total_packages ]; then
      log_info "End of batch $batch_no. Waiting $BATCH_DELAY seconds before next batch..."
      sleep "$BATCH_DELAY"
    fi
    
    batch_no=$((batch_no + 1))
  done

  
  # -------- LOGGING --------
  local total_published=$((current - failed))
  log_info "Completed publishing $total_published/$total_packages packages successfully ($failed failed)"
  
  if [ "$failed" -gt 0 ]; then
    log_info "Failed packages available at → $RELEASE_FAILED_JSON"
    jq '.' "$RELEASE_FAILED_JSON"
  fi
}
