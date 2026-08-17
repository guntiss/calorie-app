import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'

export const foodKindEnum = pgEnum('food_kind', ['item', 'recipe'])
export const goalInputModeEnum = pgEnum('goal_input_mode', ['grams', 'percent'])

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('users_google_sub_idx').on(t.googleSub),
  index('users_household_idx').on(t.householdId)
])

export const householdInvites = pgTable('household_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('household_invites_code_idx').on(t.code)
])

/**
 * Items and recipes share this table. A recipe is a food with `kind = 'recipe'`
 * plus rows in `recipe_components`; its macro columns are derived from those
 * components and cached here so that everything loggable — item or recipe — is
 * just a food id to the rest of the system.
 */
export const foods = pgTable('foods', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Mirrored from the owner at write time. This column is what shares the library. */
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),

  kind: foodKindEnum('kind').notNull().default('item'),
  name: text('name').notNull(),
  brand: text('brand'),
  /**
   * What is printed on the packet, stored exactly as the camera read it.
   *
   * Deliberately not unique: the same packet is one food to one household and
   * another to the next, a shop's own label is reused across products, and a
   * code typed in wrong is a correction to make rather than a save to refuse.
   * A lookup takes the first food it finds carrying the code.
   */
  barcode: text('barcode'),
  isArchived: boolean('is_archived').notNull().default(false),

  /** Always per 100 g: there is one way to weigh a food, so there is nothing to choose. */
  kcal: doublePrecision('kcal').notNull().default(0),
  protein: doublePrecision('protein').notNull().default(0),
  fat: doublePrecision('fat').notNull().default(0),
  carbs: doublePrecision('carbs').notNull().default(0),

  /** Recipes only: finished weight of the whole dish. */
  yieldGrams: doublePrecision('yield_grams'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('foods_owner_idx').on(t.ownerUserId),
  index('foods_household_idx').on(t.householdId),
  index('foods_name_idx').on(t.name),
  // Scanning a packet asks this question and nothing else, and asks it while
  // someone is holding a phone over a tin waiting for an answer.
  index('foods_barcode_idx').on(t.barcode)
])

export const recipeComponents = pgTable('recipe_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentFoodId: uuid('parent_food_id').notNull().references(() => foods.id, { onDelete: 'cascade' }),
  childFoodId: uuid('child_food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
  quantity: doublePrecision('quantity').notNull(),
  position: integer('position').notNull().default(0)
}, t => [
  index('recipe_components_parent_idx').on(t.parentFoodId)
])

/** Meal sections are per-user rows rather than an enum so they can be renamed. */
export const meals = pgTable('meals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0)
}, t => [
  index('meals_user_idx').on(t.userId)
])

/**
 * Goals are versioned by `effectiveFrom` so that changing today's target does
 * not rewrite what past days were measured against. The goal for a date is the
 * newest row with `effective_from <= date`.
 */
export const dailyGoals = pgTable('daily_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  effectiveFrom: date('effective_from').notNull(),

  kcal: doublePrecision('kcal').notNull().default(0),
  protein: doublePrecision('protein').notNull().default(0),
  fat: doublePrecision('fat').notNull().default(0),
  carbs: doublePrecision('carbs').notNull().default(0),

  /** Which side the user edits. Grams are always written, so day math never re-derives. */
  inputMode: goalInputModeEnum('input_mode').notNull().default('grams'),
  proteinPct: doublePrecision('protein_pct'),
  fatPct: doublePrecision('fat_pct'),
  carbsPct: doublePrecision('carbs_pct'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('daily_goals_user_date_idx').on(t.userId, t.effectiveFrom)
])

/**
 * A logged row.
 *
 * Every row names a food in the library — there is no such thing as logging
 * something the library has never heard of, which is why the food a row points
 * at can never be deleted out from under it.
 *
 * The macro columns are a resolved snapshot of that food at the logged amount,
 * always written, so that editing a food tomorrow never rewrites yesterday's
 * totals.
 */
export const logEntries = pgTable('log_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  logDate: date('log_date').notNull(),
  mealId: uuid('meal_id').references(() => meals.id, { onDelete: 'set null' }),
  position: integer('position').notNull().default(0),

  /** Restricted rather than cascaded: a logged food is a food you keep. */
  foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
  /** The food's name as it was when logged. Written from the food, never typed. */
  nameSnapshot: text('name_snapshot').notNull(),

  quantity: doublePrecision('quantity'),

  /** The count toggle: keeps the row on the list but out of every total. */
  counted: boolean('counted').notNull().default(true),

  /** Resolved server-side from the food on every write. */
  kcal: doublePrecision('kcal'),
  protein: doublePrecision('protein'),
  fat: doublePrecision('fat'),
  carbs: doublePrecision('carbs'),

  /** Set when this row was copied from a household member's log. */
  sourceEntryId: uuid('source_entry_id').references((): AnyPgColumn => logEntries.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('log_entries_user_date_idx').on(t.userId, t.logDate),
  // Deleting a food asks "has this ever been logged?", so that question is indexed.
  index('log_entries_food_idx').on(t.foodId)
])

/**
 * What Gemini has already been asked, and what it said.
 *
 * Every lookup costs money and a couple of seconds, and the questions repeat:
 * the foods people leave blank are the same handful, and every member of a
 * household leaves the same ones blank. A request is identified by its whole
 * content — model, instructions, question, answer shape — so a changed prompt
 * asks afresh rather than serving an answer to a different question.
 *
 * A null `response` is a real entry: it records that the model was asked and
 * gave back nothing usable. Without it the names the model has no answer for
 * are the ones paid for over and over.
 */
export const geminiCache = pgTable('gemini_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Hash of the entire request. The lookup key; the columns below are for reading by eye. */
  requestHash: text('request_hash').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  /** The parsed answer, or null when nothing usable came back. */
  response: jsonb('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('gemini_cache_request_idx').on(t.requestHash)
])

export type User = typeof users.$inferSelect
export type Household = typeof households.$inferSelect
export type Food = typeof foods.$inferSelect
export type NewFood = typeof foods.$inferInsert
export type RecipeComponent = typeof recipeComponents.$inferSelect
export type Meal = typeof meals.$inferSelect
export type DailyGoal = typeof dailyGoals.$inferSelect
export type LogEntry = typeof logEntries.$inferSelect
export type NewLogEntry = typeof logEntries.$inferInsert
export type GeminiCacheEntry = typeof geminiCache.$inferSelect
