# Monthly deployment history and current state

History lives in one issue per category and UTC completion month:
`Deployment log | cdns | 2026-10`. Each deployment comment identifies the app,
source repository/SHA, environment/Production target, result, time, workflow and URLs.
Dev, QA, Preview and Production attempts are included. `kind` distinguishes promotions
from routine rebuilds; TVA stays on source commits.

The resolver derives category from the app's registry group and passes it through
result capture. The immutable public result artifact includes category. The monthly
preparation action validates the record against the current app, target and run,
then locates or creates the category/month issue under a per-category concurrency
lock: `deployment-monthly-<caller repo>-<category>`. It creates a
`deployment-history:<category>` label automatically and uses label-filtered lookup.
When a new monthly issue is created, older open monthly issues for that category
are closed. Closed months remain readable and accept late entries/recovery for their
original month. An older retry never reopens a month or closes a newer month.

Current state stays in one closed app issue, titled `Deployment state | <app>`.
The existing app issue is reused; old comments remain in place. Its body indexes
the latest attempt and success independently for each environment/Production target,
linking to the relevant monthly comment. Failed attempts and month rotation never
replace a successful SHA. The scheduler reads this stable index, not monthly history.
Supply `JOURNAL_ISSUE` for one issue GET; the scheduler directory includes closed
state issues. No release tags or source-repository changes are needed.

Index writes use `deployment-journal-<caller repo>-<app>`, with `queue: max` and
`cancel-in-progress: false`. The controller bootstrap/recovery job holds the same
app lock. Monthly preparation runs in its own job, releasing the category lock before
the app writer starts. Comment appends for different apps can proceed concurrently;
only creation/rotation is serialized per category. All callers that mutate an app
index must use its app lock.

Before appending, the writer persists both the record and the prepared monthly
issue number as a durable intent in the app index. If interrupted, a locked read or
write recovers that exact monthly entry before exposing the successful SHA. Recovery
can search older monthly pages when other apps have appended more entries; normal
indexed reads do not scan history. Normal appends use a bounded recent-page duplicate
check. An old event outside that window and no longer in the current index is not a
replay interface. Rerunning only a failed journal job retains the original artifact's
deployment event ID and completion month. Metadata expires after seven days.

Legacy app journals bootstrap from their existing comments once. Existing pending
per-app writes finish in their original issue before new writes move to monthly
history. Existing indexes and all old comment links are preserved. `UPDATE_INDEX:
true` requires Issues write and the app lock; read-only calls cannot repair pending
writes. New state writes rename and close the state issue. Already indexed apps move
to the closed state presentation on their next write.

State body size remains bounded. Corrupt indexes, wrong app/category/month references
and permission errors fail explicitly. API quota reset/retry-after headers are honored
with bounded retries. No secret values or build output are stored in history.
