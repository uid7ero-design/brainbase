#!/usr/bin/env bash
# CRM duplicate prevention: disposable-Postgres proof, with FORCED concurrency, of the REAL application code
# (Events sync, Events backfill, POST /api/crm/contacts, PUT /api/crm/contacts/[id]).
#
# Starts a FRESH postgres container (never touches Production, Neon or any running database) and runs
# scripts/tests/crmContactDuplicatePrevention.integration.test.ts against it. The suite includes a negative control: the
# previous single-statement lock-and-read shape, which MUST still duplicate under the same forced overlap.
#
# USAGE   bash scripts/tests/verify-crm-contact-duplicate-prevention.sh [PG_MAJOR]      (default 17, the Neon major version)
# Not wired into CI (Docker is not part of the standard CI workflow in this repo).

set -uo pipefail

PG_MAJOR="${1:-17}"
NAME="crm-dedupe-proof-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 2; }

echo "== start postgres:${PG_MAJOR}-alpine"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pw -p 127.0.0.1::5432 "postgres:${PG_MAJOR}-alpine" -c max_connections=300 >/dev/null || exit 2
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
URL="postgres://postgres:pw@127.0.0.1:${PORT}/postgres"
echo "   version: $(docker exec "$NAME" psql -U postgres -Atc 'select version()' | cut -c1-40)"

echo "== run the real-Postgres suite"
CRM_TEST_DATABASE_URL="$URL" npx vitest run --config vitest.integration.config.ts --reporter=verbose scripts/tests/crmContactDuplicatePrevention.integration.test.ts
RC=$?
if [ "$RC" -eq 0 ]; then echo "CRM DUPLICATE-PREVENTION PROOF: PASS"; else echo "CRM DUPLICATE-PREVENTION PROOF: FAIL"; fi
exit "$RC"
