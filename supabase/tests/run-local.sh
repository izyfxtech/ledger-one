#!/usr/bin/env bash
# Applies the migration to a scratch database and runs the RLS/sync checks.
# Usage: PGHOST=... PGUSER=postgres ./run-local.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=ledgerone_test
psql -v ON_ERROR_STOP=1 -qc "drop database if exists $DB" postgres
psql -v ON_ERROR_STOP=1 -qc "create database $DB" postgres
psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase_stub.sql
psql -v ON_ERROR_STOP=1 -q -d $DB -f ../migrations/20261001000000_ledger_sync.sql
psql -v ON_ERROR_STOP=1 -q -d $DB -f rls_and_sync.sql
