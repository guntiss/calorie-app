import { and, asc, eq } from 'drizzle-orm'
import type { LogEntry, User as UserRecord } from '../database/schema'

/**
 * The macros stored on a row, or null when it has none yet.
 *
 * A quick-added row is allowed to sit in the log with no numbers at all, so
 * "no macros" has to be a distinct state from "zero macros" — the day totals
 * report the former as incomplete and the latter as genuinely nothing.
 */
export function entryMacros(entry: LogEntry): Macros | null {
  const hasAny = entry.kcal !== null || entry.protein !== null
    || entry.fat !== null || entry.carbs !== null
  if (!hasAny) return null
  return {
    kcal: entry.kcal ?? 0,
    protein: entry.protein ?? 0,
    fat: entry.fat ?? 0,
    carbs: entry.carbs ?? 0
  }
}

/**
 * Everything needed to render one day, in a single round trip.
 *
 * Totals are computed here with the same `dayTotals` the client uses, so the
 * server's answer and the grid's live answer cannot drift apart.
 */
export async function loadDay(user: UserRecord, date: string) {
  const db = useDb()

  const [entries, mealRows, goal] = await Promise.all([
    db
      .select()
      .from(tables.logEntries)
      .where(and(
        eq(tables.logEntries.userId, user.id),
        eq(tables.logEntries.logDate, date)
      ))
      .orderBy(asc(tables.logEntries.position), asc(tables.logEntries.createdAt)),
    db
      .select()
      .from(tables.meals)
      .where(eq(tables.meals.userId, user.id))
      .orderBy(asc(tables.meals.position)),
    goalForDate(user.id, date)
  ])

  const totals = dayTotals(entries.map(e => ({
    counted: e.counted,
    macros: entryMacros(e)
  })))

  return { date, meals: mealRows, entries, goal, totals }
}

export type DayPayload = Awaited<ReturnType<typeof loadDay>>
