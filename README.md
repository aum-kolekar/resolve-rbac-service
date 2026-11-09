# Resolve — RBAC (Access Control) Service

Owns `permissions`, `roles`, `role_permissions`, `user_roles` in Postgres.
Redis is a pure cache in front of it (§10), never a source of truth — if
Redis is flushed entirely, this service keeps working correctly, just
slower until the cache warms back up.

Full API contract, edge-case table, and caching policy are the frozen
source of truth in the shared docs repo:

- `Contracts/RBAC_Service.md`
- `Schemas/04_RBAC_Service_Schema.md`

## Stack

- Node.js 20 LTS, plain JavaScript (CommonJS), Express
- Postgres via `pg`, migrations via `node-pg-migrate`
- Redis via `ioredis` (cache only)
- JWT verification via `jose`'s `createRemoteJWKSet` (fetches + caches Authentication Service's JWKS automatically)
- Jest + Supertest — integration tests run against a **real** Postgres (no in-memory Postgres mock exists that's worth trusting for this), Redis is mocked via `ioredis-mock`
- ESLint (flat config) + Prettier

## Dependency: Authentication Service (JWT verification only)

This service never issues tokens — it verifies tokens Authentication Service
already issued, the same way every other service will. `USE_MOCK_JWKS=true`
(default) points at a local mock JWKS server (`mocks/server.js`) that also
exposes a `signMockAccessToken()` helper tests use to mint tokens shaped
exactly like real ones. Flip to `false` and point `AUTHENTICATION_SERVICE_URL`
at a real running Authentication Service once both are up together. For the standalone Compose
project, set `USE_MOCK_JWKS=false` and `AUTHENTICATION_SERVICE_URL` in `.env` to the reachable
Authentication Service URL; the default mock configuration is only for isolated local development.

## Getting started

Requires a real Postgres (no way around it — this service's core function
**is** its Postgres tables).

```bash
cp .env.example .env
# Change RBAC_POSTGRES_PASSWORD before using this outside local development.
npm install

# RBAC owns this PostgreSQL instance; it is not shared with Authentication Service.
# Easiest with Docker (from this directory):
docker compose up -d rbac-postgres redis

npx node-pg-migrate up   # creates tables + seeds the permission catalog

npm run mocks    # terminal 1 - JWKS mock
npm run dev      # terminal 2 - the service itself
curl http://localhost:4300/health
```

Or the whole RBAC stack in one shot: `docker compose up --build` (starts the dedicated
`rbac-postgres`, runs migrations, then starts `rbac-service`). PostgreSQL data persists in the
`resolve_rbac_service_postgres_data` named volume. The database is on a private internal Compose
network shared only with RBAC and its migration job; `docker compose down -v` deletes it. This standalone Compose project is an alternative to the root integrated stack, not an additional stack to run alongside it (both expose the same local development ports).

## Scripts

| Command                               | Purpose                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev` / `npm start`           | Start (with/without reload)                                        |
| `npm run migrate:up` / `migrate:down` | Run/roll back migrations                                           |
| `npm run mocks`                       | Start the mock JWKS server                                         |
| `npm test`                            | Run all tests (needs a real Postgres reachable via `DATABASE_URL`) |
| `npm run lint` / `format`             | ESLint / Prettier                                                  |

## Project layout

```
src/
  config/       env loading
  db/           Postgres pool + health check
  cache/        Redis client + the flattened-permission cache (§10)
  services/     permissionService (the hot-path check), roleService, userRoleService
  controllers/  request/response glue
  routes/       public (/api/v1/rbac/*) and internal (/internal/v1/authz/*)
  middleware/   authenticate (JWT), internalAuth, requirePermission, error handling
  errors/       AppError + error-code catalog (Contract §8)
migrations/     node-pg-migrate files - schema, then seed data
mocks/          Mock JWKS server + token-signing helper for tests
tests/
  unit/         seed-data correctness
  integration/  full authenticated flow, cache invalidation, anti-enumeration
```

## Status

**Built and verified end-to-end:** permission catalog seed, role CRUD
(including system-role immutability and cross-tenant anti-enumeration),
user-role assignment/revocation, the internal hot-path check + bulk-check
endpoints, and — the part most worth calling out — **cache invalidation is
verified to actually happen on mutation**, not just assumed: the test suite
checks a permission immediately after revoking/editing a role and confirms
it's already correct, not stale for up to the 60-second TTL.

**Known gaps, carried over from the contract, not silently resolved:**

- No mechanism yet grants the _first_ `ORG_ADMIN` when a new tenant is
  onboarded (Schema §4) — Organization Service's contract doesn't call this
  service at all yet.
- The self-lockout scenario (last `ORG_ADMIN` revokes their own role) is not
  prevented (Contract §6) — deliberately, since no recovery mechanism is
  documented anywhere in this doc set either.
- `FR-AUZ-06` (resource-level auth) and `FR-AUZ-07` (ABAC) are not implemented — both Could-have, both out of scope for this build.
