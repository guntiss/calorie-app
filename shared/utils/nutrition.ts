/**
 * Nutrition math.
 *
 * This module is deliberately pure and dependency-free: the exact same code runs
 * in the reactive day grid (recomputing on every keystroke) and on the server
 * (recomputing authoritative values before they are written). If these two ever
 * disagreed, the totals a user saw while typing would not match what got saved.
 */

export type MacroKey = 'kcal' | 'protein' | 'fat' | 'carbs'

export interface Macros {
  kcal: number
  protein: number
  fat: number
  carbs: number
}

/** Kcal contributed per gram of each macronutrient (Atwater factors). */
export const KCAL_PER_GRAM = { protein: 4, fat: 9, carbs: 4 } as const

export function emptyMacros(): Macros {
  return { kcal: 0, protein: 0, fat: 0, carbs: 0 }
}

export function scaleMacros(m: Macros, factor: number): Macros {
  return {
    kcal: m.kcal * factor,
    protein: m.protein * factor,
    fat: m.fat * factor,
    carbs: m.carbs * factor
  }
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs
  }
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(addMacros, emptyMacros())
}

export function roundMacros(m: Macros, decimals = 1): Macros {
  const f = 10 ** decimals
  return {
    kcal: Math.round(m.kcal),
    protein: Math.round(m.protein * f) / f,
    fat: Math.round(m.fat * f) / f,
    carbs: Math.round(m.carbs * f) / f
  }
}

/** Energy implied by the macronutrients alone, ignoring any stored kcal value. */
export function kcalFromMacros(m: Pick<Macros, 'protein' | 'fat' | 'carbs'>): number {
  return (
    m.protein * KCAL_PER_GRAM.protein
    + m.fat * KCAL_PER_GRAM.fat
    + m.carbs * KCAL_PER_GRAM.carbs
  )
}

/**
 * How far a stated kcal may sit from the energy its macros imply before it is
 * worth querying.
 *
 * Small gaps are normal and not worth a warning: labels round every number, and
 * fibre and polyols carry less energy than the Atwater factors assume. The
 * absolute floor stops rounding on a low-calorie food from reading as an error,
 * and the ratio keeps the check meaningful on a calorie-dense one.
 */
export const KCAL_MISMATCH_TOLERANCE = { kcal: 10, ratio: 0.1 } as const

export interface KcalMismatch {
  /** Energy the macros come to, rounded the way the kcal field would hold it. */
  implied: number
  /** Stated minus implied. Positive when the stated kcal is the higher one. */
  difference: number
}

/**
 * Check a food's stated kcal against the energy in its macronutrients.
 *
 * Returns null when the two agree closely enough, and also when there is
 * nothing to compare: a food whose macros are all still zero is unfinished
 * rather than wrong, and a half-typed field is not a claim about anything.
 *
 * This only ever reports — a mismatch is a question for the person who entered
 * the numbers, not something to correct behind their back, because either side
 * of it can be the one that is right.
 */
export function kcalMismatch(m: Macros): KcalMismatch | null {
  if (![m.kcal, m.protein, m.fat, m.carbs].every(v => Number.isFinite(v))) return null
  if (m.protein === 0 && m.fat === 0 && m.carbs === 0) return null

  const implied = Math.round(kcalFromMacros(m))
  const difference = Math.round(m.kcal) - implied
  const tolerance = Math.max(
    KCAL_MISMATCH_TOLERANCE.kcal,
    implied * KCAL_MISMATCH_TOLERANCE.ratio
  )

  return Math.abs(difference) > tolerance ? { implied, difference } : null
}

/**
 * Resolve the macros for a logged amount of a food.
 *
 * Every food's macros are per 100 g, and `quantity` is the grams logged.
 */
export function resolveMacros(food: Macros, quantity: number): Macros {
  if (!Number.isFinite(quantity) || quantity <= 0) return emptyMacros()

  return scaleMacros(food, quantity / 100)
}

/** One component of a recipe: a child food at a quantity. */
export interface RecipeComponent {
  food: Macros
  quantity: number
}

/**
 * Derive a recipe's per-100g macros from its components and its finished weight.
 *
 * `yieldGrams` is what the pot weighs when cooking is done, which is how a
 * portion of the recipe can later be logged by simply weighing the plate.
 */
export function recipeMacrosPer100g(
  components: RecipeComponent[],
  yieldGrams: number
): Macros {
  if (!Number.isFinite(yieldGrams) || yieldGrams <= 0) return emptyMacros()
  const total = sumMacros(components.map(c => resolveMacros(c.food, c.quantity)))
  return scaleMacros(total, 100 / yieldGrams)
}

/**
 * Combined weight of a recipe's components — a starting point for `yieldGrams`,
 * which the user corrects with what the finished pot actually weighs.
 */
export function recipeComponentsWeight(components: RecipeComponent[]): number {
  return components.reduce((sum, c) => sum + c.quantity, 0)
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface MacroPercents {
  protein: number
  fat: number
  carbs: number
}

/**
 * Split a kcal target into macro grams by percentage of energy.
 * Percentages are of total calories, not of weight.
 */
export function goalsFromPercent(kcal: number, pct: MacroPercents): Macros {
  return {
    kcal,
    protein: (kcal * pct.protein) / 100 / KCAL_PER_GRAM.protein,
    fat: (kcal * pct.fat) / 100 / KCAL_PER_GRAM.fat,
    carbs: (kcal * pct.carbs) / 100 / KCAL_PER_GRAM.carbs
  }
}

/**
 * Express macro grams as percentages of the kcal goal.
 * Falls back to the energy the macros themselves imply when no kcal goal is set,
 * so the percent view is still meaningful while a user is mid-edit.
 */
export function goalsToPercent(goal: Macros): MacroPercents {
  const basis = goal.kcal > 0 ? goal.kcal : kcalFromMacros(goal)
  if (basis <= 0) return { protein: 0, fat: 0, carbs: 0 }
  return {
    protein: (goal.protein * KCAL_PER_GRAM.protein * 100) / basis,
    fat: (goal.fat * KCAL_PER_GRAM.fat * 100) / basis,
    carbs: (goal.carbs * KCAL_PER_GRAM.carbs * 100) / basis
  }
}

// ---------------------------------------------------------------------------
// Day totals
// ---------------------------------------------------------------------------

/** The parts of a log entry that day totals care about. */
export interface TotalableEntry {
  /** The count toggle. `false` keeps the row on the list but out of every total. */
  counted: boolean
  /** Null while a quick-added row still has no macros filled in. */
  macros: Macros | null
}

export interface DayTotals {
  /** Every counted row, summed. */
  total: Macros
  /** True when some counted row is still missing its macros, so totals understate. */
  hasIncomplete: boolean
}

export function dayTotals(entries: TotalableEntry[]): DayTotals {
  const total = emptyMacros()
  let hasIncomplete = false

  for (const entry of entries) {
    if (!entry.counted) continue
    if (!entry.macros) {
      hasIncomplete = true
      continue
    }
    total.kcal += entry.macros.kcal
    total.protein += entry.macros.protein
    total.fat += entry.macros.fat
    total.carbs += entry.macros.carbs
  }

  return { total, hasIncomplete }
}

/** Goal minus total, per macro. Negative means over. */
export function remainingMacros(goal: Macros, total: Macros): Macros {
  return {
    kcal: goal.kcal - total.kcal,
    protein: goal.protein - total.protein,
    fat: goal.fat - total.fat,
    carbs: goal.carbs - total.carbs
  }
}

/**
 * How far past a goal still counts as hitting it.
 *
 * A goal is an aim, not a limit, and a day landing within a few percent of one
 * is the day going well. Warning the moment the number ticks past would mark
 * almost every honest day in red — and a warning that shows up on a good day
 * teaches people to stop reading it. Five percent is roughly a large apple on a
 * 2,000 kcal day: past that, something was actually eaten that was not planned.
 */
export const GOAL_TOLERANCE = 0.05

/**
 * Whether a total is far enough past its goal to be worth flagging.
 *
 * The one rule behind every warning colour on the day, so the calorie meter and
 * the macro meters cannot disagree about what counts as over. Everything short
 * of it — including a day a little past its goal — is left in the ordinary
 * colours: the number already says "over", and it does not need to shout it.
 *
 * A goal of 0 means "not set" and can never be exceeded, otherwise every
 * untouched macro would read as a breach.
 */
export function isOverGoal(total: number, goal: number): boolean {
  return goal > 0 && total > goal * (1 + GOAL_TOLERANCE)
}

/** Which macros a total exceeds, by the rule in `isOverGoal`. */
export function exceededMacros(goal: Macros, total: Macros): MacroKey[] {
  const keys: MacroKey[] = ['kcal', 'protein', 'fat', 'carbs']
  return keys.filter(k => isOverGoal(total[k], goal[k]))
}
