# CI commit summaries

`summary-qa`, `summary-bnd` and `summary-release` use this common action to
create a commit comment once and update it on subsequent runs of the same
workflow against that SHA. Each summary still includes its timestamp, attempt
and workflow run link. PR sticky comments and check runs are unchanged.

A hidden marker identifies the summary kind and caller workflow file from
`GITHUB_WORKFLOW_REF`, excluding the branch or tag. Workflows with identical
display names remain separate. QA, BnD and Release never overwrite each other.
Only bot comments with the exact marker are updated. Historical comments
created by the previous implementation and human comments are preserved.
The first run after migration creates a managed comment.

The hidden run number and attempt prevent an older run or rerun from replacing
an already recorded newer result. Repeated identical writes make no API update.
Earlier results remain in Actions history.

The caller needs `contents: write` and should serialize runs that write the
same workflow summary for a SHA with workflow or job concurrency. GitHub's
commit-comment API has no atomic upsert; the ordering check does not provide a
lock for simultaneous writers. Existing QA, BnD and Release workflow templates
already configure workflow concurrency.

```yaml
- name: 🟠 · 💬 Update CI summary
  uses: vezham/vx-deployer/.github/actions/common/comment-ci-summary@timeline
  with:
    token: ${{ github.token }}
    summary_path: summary.md
    kind: qa
```

The summary file must be available in the caller workspace. This composite
loads its script from its own action directory and requires no additional
checkout or package installation.
