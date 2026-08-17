import { defineConfig } from 'drizzle-kit'

/**
 * Pick the connection migrations run over.
 *
 * Neon hands out two URLs: a pooled one for the app, and a direct one for
 * everything that needs a real session. Migrations are the latter — DDL in a
 * transaction does not survive a pooler running in transaction mode — so the
 * unpooled URL wins whenever it is present. There is deliberately no fallback
 * to localhost: a missing variable used to mean migrations quietly landed on
 * the local database and reported success.
 */
function migrationUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL
    || process.env.DATABASE_URL_UNPOOLED
    || process.env.DATABASE_URL

  if (!url) {
    throw new Error(
      'No database URL for migrations. Set MIGRATION_DATABASE_URL, '
      + 'DATABASE_URL_UNPOOLED or DATABASE_URL.'
    )
  }
  return url
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url: migrationUrl()
  }
})
