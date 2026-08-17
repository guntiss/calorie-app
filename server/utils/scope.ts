import { eq, or, type SQL } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { User as UserRecord } from '../database/schema'

/**
 * The authenticated user, read fresh from the database.
 *
 * The session cookie only carries an id, so this is the single place that turns
 * a session into a user row — and the only place that knows what to do when the
 * row has since been deleted.
 */
export async function requireDbUser(event: H3Event): Promise<UserRecord> {
  const { user } = await requireUserSession(event)

  const [record] = await useDb()
    .select()
    .from(tables.users)
    .where(eq(tables.users.id, user.id))
    .limit(1)

  if (!record) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Account no longer exists' })
  }

  return record
}

/**
 * Which foods a user may see: their own, plus their household's.
 *
 * This is the whole of the sharing model, so it lives in exactly one place —
 * every query that touches foods composes this rather than rewriting the rule.
 */
export function visibleFoodsWhere(user: UserRecord): SQL {
  if (!user.householdId) {
    return eq(tables.foods.ownerUserId, user.id)
  }
  return or(
    eq(tables.foods.ownerUserId, user.id),
    eq(tables.foods.householdId, user.householdId)
  )!
}

/** A food may only be edited by its owner or by someone in the owning household. */
export function canEditFood(user: UserRecord, food: { ownerUserId: string, householdId: string | null }): boolean {
  if (food.ownerUserId === user.id) return true
  return Boolean(user.householdId && food.householdId === user.householdId)
}
