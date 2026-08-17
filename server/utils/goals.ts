import { and, asc, desc, eq, lte } from 'drizzle-orm'
import type { DailyGoal } from '../database/schema'

/**
 * The goal in force on a given date: the newest one that had started by then.
 * Changing today's target therefore leaves past days measured against what they
 * were actually logged under.
 *
 * Dates before the very first goal fall back to that first goal, so setting a
 * goal for the first time gives the days already logged something to measure
 * against instead of leaving them blank. Once a second goal exists it changes
 * nothing: the first one still covers everything before it.
 */
export async function goalForDate(userId: string, date: string): Promise<DailyGoal | null> {
  const db = useDb()

  const [inForce] = await db
    .select()
    .from(tables.dailyGoals)
    .where(and(
      eq(tables.dailyGoals.userId, userId),
      lte(tables.dailyGoals.effectiveFrom, date)
    ))
    .orderBy(desc(tables.dailyGoals.effectiveFrom))
    .limit(1)

  if (inForce) return inForce

  const [earliest] = await db
    .select()
    .from(tables.dailyGoals)
    .where(eq(tables.dailyGoals.userId, userId))
    .orderBy(asc(tables.dailyGoals.effectiveFrom))
    .limit(1)

  return earliest ?? null
}

/** A goal shaped for the nutrition helpers. All zeroes means "not set yet". */
export function goalMacros(goal: DailyGoal | null): Macros {
  return {
    kcal: goal?.kcal ?? 0,
    protein: goal?.protein ?? 0,
    fat: goal?.fat ?? 0,
    carbs: goal?.carbs ?? 0
  }
}
