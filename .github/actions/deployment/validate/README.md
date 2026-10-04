# Validate deployment settings

Validates deployment inputs before checkout, build, or deployment. Requires Bash,
which is available on GitHub-hosted Linux, macOS, and Windows runners.

`APP_ENV` is required and accepts `dev`, `qa`, `preview`, or `production`.
`local` is deliberately excluded from deployment workflows.
`RELEASE_CHANNEL` accepts `canary`, `beta`, or `stable` and defaults to
`stable` when omitted. Explicitly empty or invalid values fail the step.

```yaml
- name: Validate deployment settings
  uses: vezham/vx-deployer/.github/actions/deployment/validate@timeline
  with:
    APP_ENV: ${{ inputs.APP_ENV }}
    RELEASE_CHANNEL: ${{ inputs.RELEASE_CHANNEL }}
```
