/** The parts of the day a meal is guessed from. */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/**
 * Which part of the day an hour falls in.
 *
 * The gaps between the main meals are snacks: an afternoon coffee and biscuit,
 * or something eaten late at night, rather than an early lunch or a second
 * dinner. Breakfast starts at four so that a two o'clock fridge raid is a snack
 * and not the first meal of the day.
 */
export function mealSlotAt(date: Date): MealSlot {
  const hour = date.getHours()
  if (hour >= 4 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 21) return 'dinner'
  return 'snack'
}

/** What a meal is called when it is the one for a slot. */
const SLOT_NAMES: Record<MealSlot, RegExp> = {
  breakfast: /breakfast|brunch/i,
  lunch: /lunch/i,
  dinner: /dinner|supper/i,
  snack: /snack/i
}

/**
 * The meal a slot means, matched on its name.
 *
 * Meals are the user's own and can be renamed, so there is no id to rely on —
 * a meal called "Late snack" is still the snack. Undefined when nothing matches,
 * and the caller falls back to whatever it would have chosen without a clock.
 */
export function mealForSlot<T extends { name: string }>(meals: T[], slot: MealSlot): T | undefined {
  return meals.find(meal => SLOT_NAMES[slot].test(meal.name))
}
