---
inclusion: always
---

# Database Standards

Best practices for database design, schema creation, migrations, and queries in the BidClean project. These rules apply to ALL database-related work: entity definitions, migrations, queries, and data modeling.

## Naming Conventions

- **Tables:** plural, snake_case (`users`, `auth_sessions`, `host_profiles`)
- **Columns:** singular, snake_case (`user_id`, `created_at`, `is_verified`)
- **Primary keys:** always named `id`
- **Foreign keys:** `<referenced_table_singular>_id` (e.g., `user_id`, `offer_id`)
- **Indexes:** `idx_<table>_<column(s)>` (e.g., `idx_users_email`, `idx_sessions_user_id`)
- **Unique constraints:** `uq_<table>_<column(s)>` (e.g., `uq_users_keycloak_id`)
- **Booleans:** prefix with `is_` or `has_` (e.g., `is_verified`, `has_portfolio`)
- **Timestamps:** always `created_at`, `updated_at`. Action-specific: `revoked_at`, `expires_at`
- **Enums/status columns:** use VARCHAR with application-level validation, not PostgreSQL ENUM type (hard to migrate)

## Primary Keys

- Always UUID v4 (`gen_random_uuid()`) — never serial/auto-increment
- UUID avoids enumeration attacks, works in distributed systems, no sequential guessing
- Column type: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`

## Foreign Keys

- Always define explicit FK constraints with `REFERENCES`
- Always specify `ON DELETE` behavior:
  - `CASCADE` — child deleted when parent deleted (sessions, profiles)
  - `SET NULL` — child keeps existing but reference nulled (soft references)
  - `RESTRICT` — prevent parent deletion if children exist (critical data)
- Always create an index on every FK column (PostgreSQL does NOT auto-index FKs)
- Never use FK without understanding the cascade implications

## Indexes

- Index every column used in `WHERE`, `JOIN`, `ORDER BY` frequently
- Index every FK column
- Use composite indexes when queries filter on multiple columns together
- Use UNIQUE index for natural uniqueness constraints
- Use GiST index for geospatial queries (PostGIS)
- Use GIN index for JSONB columns that need searching
- Don't over-index — every index slows writes. Add only what queries need.
- Run `EXPLAIN ANALYZE` on critical queries to verify index usage

## Normalization

- Minimum 3NF (Third Normal Form) for all tables
- No repeating groups, no partial dependencies, no transitive dependencies
- Denormalize ONLY with documented justification (performance, read-heavy access pattern)
- If denormalizing, document the update strategy (how does denormalized data stay in sync)

## Timestamps

- Every table has `created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
- Mutable tables also have `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
- Always use `TIMESTAMP WITH TIME ZONE` (never without timezone)
- Store in UTC, convert to user's timezone in the application layer
- Use `updated_at` trigger or application-level update for automatic tracking

## Nullability

- `NOT NULL` is the default mindset — columns are non-nullable unless there's a reason
- Nullable columns require justification: "This is null when [condition]"
- Never use empty string as a substitute for NULL
- Optional relationships use nullable FK

## Data Types

- IDs: `UUID`
- Short strings (names, emails): `VARCHAR(255)`
- Long text (descriptions): `TEXT`
- Countries: `CHAR(2)` (ISO 3166-1 alpha-2)
- Languages: `VARCHAR(35)` (BCP 47)
- Money: `NUMERIC(12,2)` or `INTEGER` (cents) — never FLOAT
- Coordinates: `DOUBLE PRECISION` for lat/lng, or `GEOGRAPHY` for PostGIS
- Booleans: `BOOLEAN`
- Dates: `DATE` (no time), `TIMESTAMP WITH TIME ZONE` (with time)
- JSON flexible data: `JSONB` (never `JSON` — JSONB is indexed and faster)
- Arrays: `VARCHAR[]` only for simple, small, non-relational lists. For complex data, normalize.
- Status/Enum: `VARCHAR(30)` with application-level validation

## Soft Delete vs Hard Delete

- **Hard delete** (default): when data is truly disposable (challenges, expired tokens, temp files)
- **Soft delete** (with `deleted_at TIMESTAMP`): when data needs audit trail or recovery (users, payments, offers)
- If using soft delete: add `deleted_at` column, add partial index `WHERE deleted_at IS NULL` for active records
- All queries on soft-delete tables MUST filter `WHERE deleted_at IS NULL` by default

## Migrations

- Every schema change is a migration file (never manual SQL in production)
- Migrations are reversible: every `up()` has a corresponding `down()`
- Migrations are idempotent when possible (use `IF NOT EXISTS`, `IF EXISTS`)
- Never modify a deployed migration — create a new one
- Migration naming: `<timestamp>-<descriptive-name>.ts`
- Destructive migrations (drop column, drop table) require explicit approval and backup verification
- Test migrations in both directions (up + down) before deploying

## Performance by Design

- Design schemas with query patterns in mind (who reads what, how often)
- Avoid N+1 patterns: use JOINs or batch loading
- Large tables: plan partitioning strategy early (by date, by country)
- Use connection pooling (configurable pool size)
- Materialized views for complex read-heavy aggregations (refresh strategy required)
- Monitor query performance: log slow queries above configurable threshold

## Separation of Concerns

- One table = one domain entity
- Don't mix domains in one table
- Cross-domain references via FK only
- Each bounded context owns its tables — other contexts reference by ID only

## Security

- Never store plaintext secrets in the database
- Sensitive columns encrypted at field level when required by regulation
- Application-level access control: queries always scoped by user/role
- Use parameterized queries exclusively (never string concatenation)
- Database credentials stored in Vault, rotated periodically

## Documentation

- Every table has a comment explaining its purpose
- Complex columns have comments explaining their meaning
- Entity files include JSDoc on every column
- Schema changes documented in CHANGELOG and migration README
