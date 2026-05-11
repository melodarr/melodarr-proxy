# Fixtures

This directory contains the "golden" response fixtures captured from a real Lidarr/SkyHook instance. These are used to guarantee contract adherence.

## Golden Fixtures Index
| Fixture File | Source Origin | Capture Date | Compatible Lidarr Version | Expected Ingestion Behavior |
|--------------|---------------|--------------|---------------------------|-----------------------------|
| | | | | |

## Workflow
1. Capture real response payload from Lidarr's upstream SkyHook server.
2. Save as `.json` in this directory.
3. Update the index above with the exact capture origin.
4. Ensure regression and compatibility tests run against these golden payloads.
