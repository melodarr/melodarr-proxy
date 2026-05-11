# Contracts

This directory tracks the strict contract definitions and expectations based on the official Lidarr models.

## Contract Decisions
*(Log decisions on how to structure payloads here)*

## Payload Expectations
- **Field Names:** Must match exactly.
- **Nullability:** Strict adherence required.
- **Nesting:** Ensure structure mirrors Lidarr.
- **Arrays & IDs:** Match serialization.

## Known Quirks
*(Document Lidarr-specific parsing quirks here)*

## Compatibility Notes
*(Link back to the compatibility matrix as needed)*

## Field Mappings
*(Map upstream provider fields to Lidarr model fields)*

## Provider Normalization Logic
*(How we sanitize data from Tidal, Spotify, MusicBrainz, etc., into Lidarr formats)*

## Serialization Behavior
*(Document JSON serialization rules expected by Lidarr, e.g., CamelCase vs PascalCase, date formatting)*
