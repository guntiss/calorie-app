/**
 * Suggested macros for a food.
 *
 * A suggestion is a typical value for a food of that name, not a fact about the
 * thing in front of you — it is offered, never applied, and it is the person
 * with the packet in their hand who decides. The shape lives here so the
 * endpoint that produces one and the dialog that offers it cannot drift apart.
 */

import type { Macros } from './nutrition'

export interface MacroSuggestion extends Macros {
  /**
   * What the numbers were taken to describe — "raw, skinless", "cooked,
   * drained". A food's macros only mean anything alongside how it was weighed,
   * and this is the reader's chance to notice the guess was the other one.
   */
  note: string
}

/**
 * What the endpoint answers with. A food it cannot place is a plain "no" rather
 * than an error: an unrecognised name is an ordinary outcome, not a fault.
 */
export type SuggestionResponse =
  | ({ known: true } & MacroSuggestion)
  | { known: false }

/**
 * Bounds a per-100 g figure has to sit inside to be worth showing.
 *
 * 100 g of anything is 100 g of macronutrients at the very most, and pure fat —
 * the densest food there is — comes to about 900 kcal. A number outside this is
 * not a debatable estimate but a mistake, most likely a per-portion figure that
 * escaped, and it is dropped rather than offered.
 */
export const SUGGESTION_LIMITS = { kcal: 900, grams: 100 } as const

/**
 * The suggestion as it can be offered, or null if its numbers are impossible.
 *
 * Rounded to what the fields would hold anyway: a suggestion carrying four
 * decimal places would claim a precision nobody has.
 */
export function sanitiseSuggestion(raw: MacroSuggestion): MacroSuggestion | null {
  const values = [raw.kcal, raw.protein, raw.fat, raw.carbs]
  if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null
  if (raw.kcal > SUGGESTION_LIMITS.kcal) return null
  if ([raw.protein, raw.fat, raw.carbs].some(v => v > SUGGESTION_LIMITS.grams)) return null

  return {
    kcal: Math.round(raw.kcal),
    protein: Math.round(raw.protein * 10) / 10,
    fat: Math.round(raw.fat * 10) / 10,
    carbs: Math.round(raw.carbs * 10) / 10,
    note: raw.note?.trim() ?? ''
  }
}
