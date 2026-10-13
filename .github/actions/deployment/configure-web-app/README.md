# Configure web app build

Writes resolved build settings into the checked-out app's `.env` and exports them
for later build steps. Existing `.env` content is preserved; the resolved settings
are appended. The file is restricted to owner access. App paths must remain within
the workspace and symlinked env files are rejected.

`BUILD_VALUES` is public JSON. `BUILD_SECRET_VALUES` maps build variable names to
Actions secret names; `AVAILABLE_SECRETS` is a secret JSON workflow input. Only
referenced secrets are selected, masked and exported. Missing secrets fail before
writing the file. This action needs no package installation.

Core app/environment/channel/debug settings are managed by the workflow. Production
also exports `V_PRODUCTION_TARGET`. Preview channel names include the actual checked-out
source SHA and named Production target, with length limiting and a hash to avoid collisions.

Run after checkout and before dependency installation/build. After deploy-config
generation, the Firebase action copies `vx/deploy/firebase/<app path>.json` to
root `firebase.json` for every environment and Production target.
