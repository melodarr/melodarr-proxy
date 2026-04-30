#!/usr/bin/env bash
set -euo pipefail

DB="/var/lib/lidarr/lidarr.db"
BACKUP="/var/lib/lidarr/lidarr.db.backup.$(date +%Y%m%d-%H%M%S)"
HISTORY_FILE="/var/lib/lidarr/metadata_uri_history.txt"

# Ensure the database exists
if [ ! -f "$DB" ]; then
    echo "Error: Lidarr database not found at $DB"
    exit 1
fi

# 1. Fetch current URI
CURRENT_URI=$(sqlite3 "$DB" "SELECT Value FROM Config WHERE Key = 'metadatasource';")
echo "Current metadata service URI: $CURRENT_URI"

# 2. Save current URI to history file
if [ -n "$CURRENT_URI" ]; then
    touch "$HISTORY_FILE"
    # Append to history only if it's not the exact same as the last entry
    if ! tail -n 1 "$HISTORY_FILE" | grep -qFx "$CURRENT_URI"; then
        echo "$CURRENT_URI" >> "$HISTORY_FILE"
    fi
fi

# Show history if available
if [ -f "$HISTORY_FILE" ] && [ -s "$HISTORY_FILE" ]; then
    echo ""
    echo "--- Previously Used URIs ---"
    cat -n "$HISTORY_FILE"
    echo "----------------------------"
    echo ""
fi

# 3. Prompt for the new URI
read -rp "Enter new Lidarr metadata service URI (or type a number from the history above): " INPUT

# Check if input is a number matching history
if [[ "$INPUT" =~ ^[0-9]+$ ]] && [ -f "$HISTORY_FILE" ]; then
    NEW_SOURCE=$(sed "${INPUT}q;d" "$HISTORY_FILE")
    if [ -z "$NEW_SOURCE" ]; then
        echo "Invalid history selection."
        exit 1
    fi
    echo "Selected from history: $NEW_SOURCE"
else
    NEW_SOURCE="$INPUT"
fi

if [ -z "$NEW_SOURCE" ]; then
    echo "URI cannot be empty. Exiting."
    exit 1
fi

# Ensure trailing slash
NEW_SOURCE="${NEW_SOURCE%/}/"

echo "Stopping Lidarr..."
systemctl stop lidarr

echo "Backing up database to: $BACKUP"
cp -a "$DB" "$BACKUP"

echo "Updating metadata source to: $NEW_SOURCE"
sqlite3 "$DB" <<SQL
UPDATE Config
SET Value = '$NEW_SOURCE'
WHERE Key = 'metadatasource';

.headers on
.mode column
SELECT Id, Key, Value
FROM Config
WHERE Key = 'metadatasource';
SQL

echo "Starting Lidarr..."
systemctl start lidarr

echo "Done."
echo "Backup saved at: $BACKUP"
echo "URI history tracked in: $HISTORY_FILE"
