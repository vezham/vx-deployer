# Promotion tracker

Maintains one tracker comment per application and full SHA in the source
repository. The helper passes the checked-out SHA, tracks automatic builds as
TVA, and tracks manual promotions using their destination environment.

Each environment row shows the latest attempt, UTC start and finish times,
the last successful deployment, actor, and workflow attempt link. A retry
does not erase the previous successful deployment. An older attempt finishing
late does not replace a newer attempt's current status.

GitHub commit statuses under `vx-promotion/<app>/<environment>` retain the
events used to rebuild the table. The comment marker identifies the tracker;
unrelated comments are left alone. Concurrent writes are reconciled with
fresh status reads. Duplicate trackers created by simultaneous starts are
consolidated when owned by the updating token. Another update can repair a
stale table because deployment events are retained separately.

The token needs **Contents: write** and **Commit statuses: write** in the
source repository. A workflow running there can use `github.token` with
`contents: write` and `statuses: write`. A workflow running in a different
repository needs `SOURCE_REPO_TOKEN` with access to the source repository.

The helper treats tracking errors as non-blocking. Cancellation is recorded
when the final tracking step runs; terminating a runner before that step can
leave an attempt marked in progress.

To check the action logic:

```sh
node --test .github/actions/deployment/comment-promotion/bin/main.test.cjs
```
