# Capture deployment result

Captures validated, public deployment metadata in a temporary `result.json` file.
The record contains the source SHA, app, registry category, environment/target, status, URLs and the
original workflow attempt. It contains no build values, secret values or credentials.
This is metadata for journal delivery; it is not the app's build artifact.

The shared build workflow uploads this single file with seven-day retention and
passes only its numeric artifact ID to the serialized journal job. Firebase masks
project IDs, so passing deployment URLs through job outputs can suppress those
outputs. The metadata artifact preserves the URLs without changing the provider action.

Monthly preparation and the app index writer both validate this original record;
its UTC completion month controls history placement, even on a later retry.
