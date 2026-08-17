/**
 * Set the goal that takes effect from a date.
 *
 * Grams are always what gets stored, whichever way the user entered them — the
 * day grid then never has to know that percentages exist. `inputMode` and the
 * percentages are kept only so the settings screen can reopen in the same mode.
 */
export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)
  const input = await readValidatedJson(event, goalInputSchema)

  const macros = input.inputMode === 'percent'
    ? goalsFromPercent(input.kcal, {
        protein: input.proteinPct ?? 0,
        fat: input.fatPct ?? 0,
        carbs: input.carbsPct ?? 0
      })
    : { kcal: input.kcal, protein: input.protein, fat: input.fat, carbs: input.carbs }

  const percents = goalsToPercent(macros)

  const [goal] = await useDb()
    .insert(tables.dailyGoals)
    .values({
      userId: user.id,
      effectiveFrom: input.effectiveFrom,
      ...macros,
      inputMode: input.inputMode,
      proteinPct: percents.protein,
      fatPct: percents.fat,
      carbsPct: percents.carbs
    })
    .onConflictDoUpdate({
      target: [tables.dailyGoals.userId, tables.dailyGoals.effectiveFrom],
      set: {
        ...macros,
        inputMode: input.inputMode,
        proteinPct: percents.protein,
        fatPct: percents.fat,
        carbsPct: percents.carbs
      }
    })
    .returning()

  return goal
})
