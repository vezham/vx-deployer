# Source repository authentication

This action uses the caller's built-in `github.token` when `GIT_REPO` matches
the caller repository. When the source repository is different, it creates a
GitHub App installation token scoped to that repository with Contents and
Commit statuses write permissions. Each job creates its own token; the
GitHub-owned action revokes it during job cleanup. Tokens are not stored as
repository secrets or passed between jobs.

## Configure the GitHub App once

1. Register an app under `vezham`, for example `Vezham Source Deployer`.
   Use `https://github.com/vezham/vx-fe-deployer` as its homepage. Disable
   webhooks; no callback URL or webhook subscription is needed for this flow.
2. Set repository permissions **Contents: read and write** and
   **Commit statuses: read and write**. Metadata read access is automatic.
3. Install the app on `vezham` and select `vx-fe-apps-cdns`. Add other source
   repositories to the installation when their promotion flows are added.
4. Copy the app's **Client ID** to the Actions variable
   `SOURCE_APP_CLIENT_ID` in `vx-fe-deployer`.
5. Generate an app private key and save the entire PEM file, including its
   BEGIN and END lines, as the Actions secret `SOURCE_APP_PRIVATE_KEY` in
   `vx-fe-deployer`. Organization variables and secrets may also be used when
   accessible to the caller repository.

TVA runs originating in the source repository need no app credentials.
Central promotions generate a separate installation token in validation and
deployment jobs. The same app installation covers future apps without a PAT
for each repository or manual token renewal. Its private key remains a
credential that you can rotate or revoke.

The tracker still lives on the selected commit in the source repository.
This authentication does not change deployment destinations or promotion order.

References:

- [Register a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Use a GitHub App in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow)
- [Create an installation token](https://github.com/actions/create-github-app-token)
