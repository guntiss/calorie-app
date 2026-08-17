import type { MacroSuggestion, SuggestionResponse } from '#shared/utils/suggestion'

/**
 * Typical macros for a food, per 100 g, worked out from its name.
 *
 * A food logged in a hurry arrives with no numbers on it, and looking a label
 * up by hand is exactly the chore that leaves a library full of zeroes. This
 * offers a starting point for the fields; nothing is written here, and nothing
 * reaches the food until someone accepts it in the dialog.
 *
 * The dialog asks again every time it opens on a food with no numbers, and the
 * foods people leave blank are the same handful — so what came back is kept in
 * `gemini_cache`, shared by every process and every member of the household.
 */

const SYSTEM = [
  'You are a nutrition reference. Given the name of a food, give typical',
  'macronutrients for 100 g of that food, as a food composition table would.',
  '',
  'Rules:',
  '- Always per 100 g of the food as named, never per portion, per serving or per package.',
  '- The name may be in any language, and may state how the food is prepared',
  '  ("rice, boiled", "chicken breast, raw"). Honour that exactly: a boiled weight',
  '  and a dry weight are different foods.',
  '- If preparation is not stated, assume the form the food is most commonly',
  '  weighed in, and say which you assumed in "note".',
  '- If a brand is given, use that product\'s own figures when you know them;',
  '  otherwise give the generic food and say so in "note".',
  '- protein, fat and carbs are grams per 100 g; kcal is the energy per 100 g.',
  '- Set "known" to false, with zeroes, if the name is not a food or means',
  '  nothing to you. Never guess wildly.',
  '- "note" is at most eight words, in the language the food was named in.'
].join('\n')

const SCHEMA = {
  type: 'object',
  properties: {
    known: { type: 'boolean' },
    kcal: { type: 'number' },
    protein: { type: 'number' },
    fat: { type: 'number' },
    carbs: { type: 'number' },
    note: { type: 'string' }
  },
  required: ['known', 'kcal', 'protein', 'fat', 'carbs', 'note']
}

export default defineEventHandler(async (event): Promise<SuggestionResponse> => {
  await requireDbUser(event)

  // No key configured is a deployment fact, not a fault of the request; the
  // dialog reads it as "no suggestions here" and shows nothing.
  if (!geminiConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Nutrition suggestions are not configured' })
  }

  const { name, brand } = await readValidatedJson(event, foodSuggestSchema)

  // Folded to one form before it is asked, so that "Rice", "rice " and "RICE"
  // all meet the same remembered answer instead of buying three of their own.
  // The model reads a lowercased name no differently.
  const asked = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()

  let answer: { known: boolean } & MacroSuggestion
  try {
    answer = await generateJson<{ known: boolean } & MacroSuggestion>({
      system: SYSTEM,
      prompt: `Food: ${asked(name)}\nBrand: ${asked(brand ?? '') || '(none)'}`,
      schema: SCHEMA
    })
  } catch (e) {
    // Whatever went wrong upstream is ours to read; to the client every one of
    // them is the same thing — there is no suggestion.
    console.error('[foods/suggest]', (e as Error).message)
    throw createError({ statusCode: 502, statusMessage: 'Could not fetch a suggestion' })
  }

  const sanitised = answer.known ? sanitiseSuggestion(answer) : null
  return sanitised ? { known: true, ...sanitised } : { known: false }
})
