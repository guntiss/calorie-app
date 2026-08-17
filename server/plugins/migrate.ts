import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Apply pending migrations at boot.
 *
 * On the container deployment the app is a single process on a private server,
 * so there is no separate migration step to orchestrate — starting the app is
 * what brings the schema up to date. A dedicated max:1 connection is used
 * because the migrator holds a lock and must not be multiplexed across the pool.
 *
 * Serverless is the exception: the SQL files are not part of the function
 * bundle and every cold start would race the others for the lock. There the
 * build command runs `db:migrate` once, before the functions are published.
 */
export default defineNitroPlugin(async () => {
  if (process.env.SKIP_MIGRATIONS === 'true' || process.env.VERCEL) return

  const client = postgres(databaseUrl(), { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: './server/database/migrations' })
    console.log('[migrate] schema up to date')
  } catch (error) {
    console.error('[migrate] failed', error)
    throw error
  } finally {
    await client.end()
  }
})
