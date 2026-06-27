#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

ogr2ogr \
  -f SQLite "$WORK_DIR/check.sqlite" \
  "$ROOT_DIR/assets/wilkinsburg_blocks_clipped.geojson" \
  -nln blocks \
  -nlt PROMOTE_TO_MULTI >/dev/null

ogr2ogr \
  -f SQLite -append "$WORK_DIR/check.sqlite" \
  "$ROOT_DIR/assets/wilkinsburg_survey_boundary.geojson" \
  -nln boundary \
  -nlt PROMOTE_TO_MULTI >/dev/null

outside_count="$(
  ogrinfo "$WORK_DIR/check.sqlite" \
    -dialect SQLITE \
    -sql "SELECT COUNT(*) AS not_covered_count FROM blocks b, boundary m WHERE NOT ST_CoveredBy(b.geometry, m.geometry)" |
    awk -F'= ' '/not_covered_count .*=/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }'
)"

if [[ "$outside_count" != "0" ]]; then
  echo "Boundary verification failed: $outside_count block geometries extend outside the survey boundary."
  exit 1
fi

echo "Boundary verification passed: 0 block geometries extend outside the survey boundary."
