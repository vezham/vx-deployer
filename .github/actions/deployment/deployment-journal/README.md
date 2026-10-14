# Deployment journal and current state

One issue per source repository/app holds the current state in its body and history
in comments. The index stores the latest attempt and success separately for every
environment/Production target. Failed attempts do not replace successful SHAs or URLs.
`kind` distinguishes manual promotions from routine rebuilds.

Supply `JOURNAL_ISSUE` to avoid scanning the issue directory. Indexed lookup needs one
issue GET. Old journals are bootstrapped by reading their history once, including
historical duplicate/closed journal issues. `UPDATE_INDEX: true` persists that bootstrap
and recovers interrupted appends; it requires Issues write and the per-app journal lock.
Read-only calls can read valid indexes or legacy history but cannot repair pending writes.

The shared workflow records the result in a separate `journal` job with the same
concurrency group as the controller resolver: `deployment-journal-<caller repo>-<app>`.
Use `queue: max` and `cancel-in-progress: false` so regional results queue instead of
cancelling. All callers that mutate the index must use that shared lock.

An intent is saved before creating the history comment. A retry/recovery finds its
recent comment by event ID or creates the missing comment, then updates the index.
Regular appends use a bounded recent comment page for deduplication instead of reading
all history. Old workflow attempts outside that recent page are not a replay interface;
Fresh build attempts have new event IDs. Rerunning only a failed journal job
uses the original result artifact and retains its deployment event ID.

State has a bounded issue-body size. Corrupt indexes fail explicitly, and unfinished
writes are recovered before a scheduled SHA is exposed. API quota reset and retry-after
headers are respected with bounded retries; authentication/authorization errors do not
silently fall back to another deployment.
