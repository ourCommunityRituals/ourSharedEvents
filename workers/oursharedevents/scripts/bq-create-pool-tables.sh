#!/usr/bin/env bash
# bq-create-pool-tables.sh: create the four pool tables in one pool dataset (OSE-1416).
#
#   bash scripts/bq-create-pool-tables.sh <gcp-project> <dataset>
#   bash scripts/bq-create-pool-tables.sh project-7cc9adcd-ed55-47aa-958 oureventring_general_stg
#
# The Worker writes these tables with insertAll (datasetForPool: oureventring_general
# on production, _stg on staging, _dev elsewhere) but never creates them. Each
# schema is bigquery/<table>.schema.json, the same file the export specs check
# every row against (tests/helpers/bigquery-pool-schema.ts).
#
# Idempotent: a table that already exists is left alone, never altered. To change
# a live table's schema, use `bq update` deliberately, not this script.
set -euo pipefail

PROJECT="${1:?usage: $0 <gcp-project> <dataset>}"
DATASET="${2:?usage: $0 <gcp-project> <dataset>}"
SCHEMA_DIR="$(cd "$(dirname "$0")/../bigquery" && pwd)"

case "$DATASET" in
  oureventring_general|oureventring_general_stg|oureventring_general_dev) ;;
  *) echo "::error::$DATASET is not a pool dataset (see BIGQUERY_DATASETS / datasetForPool)"; exit 1 ;;
esac

# Partition column per table (day partitions on the time the Worker sent the row).
declare -A PARTITION=(
  [events_backup]=backed_up_at
  [corridor_returns_export]=exported_at
  [corridor_density_baseline_export]=exported_at
  [event_series_export]=exported_at
)

for f in "$SCHEMA_DIR"/*.schema.json; do
  t="$(basename "$f" .schema.json)"
  [ -n "${PARTITION[$t]:-}" ] || { echo "::error::$t has a schema but no PARTITION entry here"; exit 1; }
done

bq show --dataset "$PROJECT:$DATASET" >/dev/null

for table in "${!PARTITION[@]}"; do
  schema="$SCHEMA_DIR/$table.schema.json"
  [ -f "$schema" ] || { echo "::error::missing $schema"; exit 1; }
  if bq show "$PROJECT:$DATASET.$table" >/dev/null 2>&1; then
    echo "exists:  $DATASET.$table (left unchanged)"
    continue
  fi
  bq mk --table \
    --schema "$schema" \
    --time_partitioning_type DAY \
    --time_partitioning_field "${PARTITION[$table]}" \
    --clustering_fields corridor_id \
    --label ticket:ose-1416 \
    "$PROJECT:$DATASET.$table" >/dev/null
  echo "created: $DATASET.$table"
done
