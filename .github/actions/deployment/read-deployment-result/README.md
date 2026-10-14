# Find deployment result artifact

Resolves a numeric artifact ID with one GitHub API request. Expired artifacts and
artifacts from a different workflow run are rejected. The output name is used by
`actions/download-artifact` for a filtered lookup, avoiding a scan of every artifact
in a run with hundreds of targets. The caller needs `actions: read` permission.

Result artifacts are retained for seven days. Rerunning only a failed journal job
reuses the original deployment event, including its run attempt; it does not label
an old deployment as a new deployment. If the artifact has expired, rerun the deployment.
