import type { H3Event } from 'h3'
import { z } from 'zod'

/** A date the client resolved in its own timezone. The server never guesses one. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

const nonNegative = z.number().nonnegative()

export const foodInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullish(),
  kind: z.enum(['item', 'recipe']).default('item'),

  /**
   * What is printed on the packet. Folded to the one form it is stored in
   * here, so that a code typed by hand in the spacing it is printed in meets
   * the same string as one read by the camera. A cleared field is no barcode
   * rather than an empty one, or two foods with nothing scanned would both
   * carry '' and answer to each other's lookups.
   */
  barcode: z.string().max(BARCODE_MAX_LENGTH * 2).nullish().transform(v => normaliseBarcode(v)),

  kcal: nonNegative.default(0),
  protein: nonNegative.default(0),
  fat: nonNegative.default(0),
  carbs: nonNegative.default(0),

  yieldGrams: z.number().positive().nullish()
})

/** What a suggestion is asked for: a food by the name it is written under. */
export const foodSuggestSchema = z.object({
  name: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(200).nullish()
})

export const foodPatchSchema = foodInputSchema.partial().extend({
  isArchived: z.boolean().optional()
})

/**
 * One row in a batch day save.
 *
 * `id` is absent for a new row. A row is nothing but a food and an amount: its
 * name and its macros are both read from the food it points at, so neither is
 * accepted from the client.
 */
export const logEntryInputSchema = z.object({
  id: z.uuid().optional(),
  mealId: z.uuid().nullish(),
  position: z.number().int().nonnegative().default(0),

  foodId: z.uuid('Every logged row must name a food in your library'),

  quantity: z.number().positive().nullish(),

  counted: z.boolean().default(true)
})

export const dayPatchSchema = z.object({
  upserts: z.array(logEntryInputSchema).max(200).default([]),
  deletes: z.array(z.uuid()).max(200).default([])
})

export const goalInputSchema = z.object({
  effectiveFrom: isoDateSchema,
  kcal: nonNegative.default(0),
  protein: nonNegative.default(0),
  fat: nonNegative.default(0),
  carbs: nonNegative.default(0),
  inputMode: z.enum(['grams', 'percent']).default('grams'),
  proteinPct: nonNegative.max(100).nullish(),
  fatPct: nonNegative.max(100).nullish(),
  carbsPct: nonNegative.max(100).nullish()
})

/** Parse a body, turning a schema failure into a 400 with readable detail. */
export async function readValidatedJson<T extends z.ZodType>(
  event: H3Event,
  schema: T
): Promise<z.output<T>> {
  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: z.treeifyError(result.error)
    })
  }
  return result.data
}
