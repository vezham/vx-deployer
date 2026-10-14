# Prepare scheduled deployment batch

Validates a JSON array of 1–100 app/Production-target entries. Each entry includes
`app`, `target` and `category`, plus an optional known `journal_issue`. Invalid IDs,
duplicate targets, invalid issue numbers and oversized batches fail before matrix
execution. The action uses the common pure schedule module and needs no install.

`scheduled-web-apps.yml` calls this action, then deploys its matrix with
`max-parallel: 5` and `fail-fast: false`. The controller runs one batch at a time
and serializes scheduler runs, so this cap is not multiplied by parallel batches.
