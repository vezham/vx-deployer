# Deployment journal

One issue in `vx-fe-deployer` records completed Dev, QA, Preview and Production
attempts for each app and source repository. TVA remains in the source commit
tracker and is excluded from this journal.

Each entry includes the full source SHA, environment, actual attempt result,
UTC start and finish timestamps, actor, trigger, successful deployment URLs,
and workflow attempt link. A hidden schema-versioned JSON record lets
scheduled workflows read the journal without parsing Markdown.

The writer creates the issue if necessary and appends one comment per
workflow run, attempt, app and environment. Repeating a write for the same
attempt does not add another entry; conflicting records fail. Simultaneous
first deployments use the oldest matching issue and close duplicate bot
issues. The reader also includes history from any duplicates.

## Integration

`static-cdn.helper.yml` captures the deployment result immediately after the
Firebase action, before tracker and journal writes. It journals only promotion
runs initiated in `vezham/vx-fe-deployer`, using its built-in `github.token`.
The manual dispatcher and reusable promotion workflow grant `issues: write`.
No additional GitHub App permissions or source-repository credentials are
needed for the journal.

A journal write error fails the run after deployment so missing history is
visible. It does not undo a successful deployment. Cancellation is recorded
if the runner executes the final steps. Entries remain editable GitHub
comments; this is an operational journal, not an immutable audit store.

## Read the current production SHA

```yaml
- name: Read current production deployment
  id: current
  uses: vezham/vx-deployer/.github/actions/deployment/read-deployment-journal@timeline
  with:
    JOURNAL_REPO: vezham/vx-fe-deployer
    GIT_REPO: vezham/vx-fe-apps-cdns
    APP_NAME: static-cdn
    APP_ENV: production
```

The reader paginates the issue comments, validates bot-authored structured
entries, and selects the latest successful deployment by completion time.
Failed or cancelled attempts do not replace the last success. A successful
rollback becomes current even when its source commit is older.

Outputs include `found`, `sha`, `finished_at`, `workflow_url`, `issue_url`,
`entry_url`, `preview_url`, and `live_url`. No success returns `found: 'false'`
and an empty SHA. API errors fail the reader. The scheduler must skip when
`found` is false; it must not substitute the source branch head.

History starts with promotions using this implementation. Existing
deployments are not inferred or backfilled. The reader is available for the
production scheduler; schedule behavior is configured separately.

## Verify the journal logic

```sh
node --test .github/actions/deployment/deployment-journal/bin/journal.test.cjs
```
