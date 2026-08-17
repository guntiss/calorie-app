import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'

export const tables = schema

type Database = ReturnType<typeof drizzle<typeof schema>>

let _db: Database | undefined
let _client: postgres.Sql | undefined

export function databaseUrl(): string {
  // DATABASE_URL is the conventional name and is what drizzle-kit reads, so it
  // wins; the runtime config entry keeps it configurable the Nuxt way too.
  const url = process.env.DATABASE_URL || useRuntimeConfig().databaseUrl
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  return url
}

export function useDb(): Database {
  if (!_db) {
    // Each serverless instance is its own process, so a 10-connection pool per
    // instance exhausts the database under any concurrency; and the poolers
    // those platforms front Postgres with run in transaction mode, where named
    // prepared statements do not survive between queries.
    const serverless = !!process.env.VERCEL
    _client = postgres(databaseUrl(), {
      max: serverless ? 1 : 10,
      prepare: !serverless
    })
    _db = drizzle(_client, { schema })
  }
  return _db
}
