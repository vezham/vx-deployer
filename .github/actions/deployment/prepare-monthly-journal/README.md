# Prepare monthly deployment history

Call under `deployment-monthly-<caller repo>-<category>` concurrency, with
`cancel-in-progress: false` and `queue: max`. The shared web workflow runs this as
an independent job after public result capture. It validates the original deployment
identity and selects the UTC month of `finished_at`, including during journal retries.

Creates or finds `Deployment log | <category> | <YYYY-MM>` and the automatic
`deployment-history:<category>` label with the repository token's Issues write
permission. Lookups are filtered by that label and month start. Older open category
months close when a newer month is first created. Existing closed months are reused
for late records. Pass `issue_number` to the app-locked journal writer.

The app state index remains separate and keeps the last successful SHA across
monthly boundaries. Preparing a monthly issue does not mark a deployment successful
or alter source commit promotion statuses.
