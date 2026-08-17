/**
 * Reading numbers out of a text field.
 *
 * Every field in the app that takes a number is a plain text input rather than
 * `type="number"`. iOS draws its decimal keypad with whichever separator the
 * phone's region uses — a comma across most of Europe — while a number input
 * refuses the very character its own keyboard hands it: "1,5" arrives as an
 * empty value, so on those phones a decimal simply cannot be typed. A text
 * input keeps every keystroke, and the translating is done here instead.
 */

/** What a number field holds: a number, or nothing yet. */
export type NumericValue = number | ''

/**
 * The text a field should show for what was just typed into it.
 *
 * Runs on every keystroke, so it has to let a half-finished number stand: "1."
 * is on its way to 1.5 and must survive being looked at. Nothing here is
 * rejected outright — a stray letter is dropped and the rest of the number is
 * kept, so a mistyped character costs one keystroke rather than the field.
 */
export function cleanNumeric(typed: string): string {
  // The comma is the point: that is the whole reason this file exists.
  const pointed = typed.replace(/,/g, '.')
  // No minus sign — every number in the app is a weight or a count of calories,
  // and none of them means anything below zero.
  const digits = pointed.replace(/[^\d.]/g, '')

  // Only the first point survives, and it is the later one that goes: someone
  // retyping the point in "1.5" should not lose the 5 they already typed.
  const [whole = '', ...rest] = digits.split('.')
  return rest.length ? `${whole}.${rest.join('')}` : whole
}

/**
 * The number that text stands for, or `''` when it does not stand for one yet.
 *
 * An empty field is not a zero — it is a number not yet given — and neither is
 * a lone point, which is what a field looks like for one keystroke.
 */
export function parseNumeric(text: string): NumericValue {
  if (text === '') return ''
  const value = Number(text)
  return Number.isFinite(value) ? value : ''
}

/** The text a field should show for a value handed to it from outside. */
export function formatNumeric(value: NumericValue | null | undefined): string {
  return value === '' || value === null || value === undefined ? '' : String(value)
}
