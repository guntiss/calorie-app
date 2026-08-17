import { describe, expect, it } from 'vitest'
import {
  dayTotals,
  exceededMacros,
  GOAL_TOLERANCE,
  goalsFromPercent,
  goalsToPercent,
  isOverGoal,
  kcalFromMacros,
  kcalMismatch,
  recipeComponentsWeight,
  recipeMacrosPer100g,
  remainingMacros,
  resolveMacros,
  type Macros
} from './nutrition'

/** Dry rice, weighed dry. Boiled rice would be a separate food. */
const rice: Macros = {
  kcal: 360,
  protein: 7,
  fat: 1,
  carbs: 79
}

/** Whole egg, shelled. */
const egg: Macros = {
  kcal: 143,
  protein: 12.6,
  fat: 9.5,
  carbs: 0.7
}

/** Chicken breast, weighed raw. */
const chicken: Macros = {
  kcal: 120,
  protein: 23,
  fat: 2.6,
  carbs: 0
}

const approx = (m: Macros) => ({
  kcal: +m.kcal.toFixed(4),
  protein: +m.protein.toFixed(4),
  fat: +m.fat.toFixed(4),
  carbs: +m.carbs.toFixed(4)
})

describe('resolveMacros', () => {
  it('scales per-100g macros by the weight logged', () => {
    expect(approx(resolveMacros(rice, 50))).toEqual({
      kcal: 180, protein: 3.5, fat: 0.5, carbs: 39.5
    })
    expect(approx(resolveMacros(rice, 300))).toEqual({
      kcal: 1080, protein: 21, fat: 3, carbs: 237
    })
  })

  it('returns zeroes for empty, negative or non-finite quantities', () => {
    const zero = { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    expect(resolveMacros(rice, 0)).toEqual(zero)
    expect(resolveMacros(rice, -50)).toEqual(zero)
    expect(resolveMacros(rice, Number.NaN)).toEqual(zero)
  })
})

describe('kcalMismatch', () => {
  it('stays quiet when the stated kcal matches its macros', () => {
    // 7*4 + 1*9 + 79*4 = 353, close enough to the 360 on the packet.
    expect(kcalMismatch(rice)).toBeNull()
    expect(kcalMismatch(chicken)).toBeNull()
    expect(kcalMismatch(egg)).toBeNull()
  })

  it('reports the implied kcal and the gap when they disagree', () => {
    // A digit dropped from the packet: 353 implied against 35 stated.
    expect(kcalMismatch({ ...rice, kcal: 35 })).toEqual({ implied: 353, difference: -318 })
    // A digit gained: 3530 stated.
    expect(kcalMismatch({ ...rice, kcal: 3530 })).toEqual({ implied: 353, difference: 3177 })
  })

  it('flags macros that imply energy against a kcal left at zero', () => {
    expect(kcalMismatch({ ...chicken, kcal: 0 })).toEqual({ implied: 115, difference: -115 })
  })

  it('tolerates label rounding rather than treating every gap as an error', () => {
    // 353 implied; a 10% band reaches 388.
    expect(kcalMismatch({ ...rice, kcal: 385 })).toBeNull()
    expect(kcalMismatch({ ...rice, kcal: 400 })).not.toBeNull()
  })

  it('allows an absolute gap on a food too small for the ratio to cover', () => {
    // 2g of carbs implies 8 kcal, where 10% is under a single kcal.
    const drink = { kcal: 15, protein: 0, fat: 0, carbs: 2 }
    expect(kcalMismatch(drink)).toBeNull()
    expect(kcalMismatch({ ...drink, kcal: 40 })).toEqual({ implied: 8, difference: 32 })
  })

  it('says nothing about a food whose macros are all still zero', () => {
    expect(kcalMismatch({ kcal: 250, protein: 0, fat: 0, carbs: 0 })).toBeNull()
  })

  it('says nothing while a field is empty rather than wrong', () => {
    expect(kcalMismatch({ kcal: Number.NaN, protein: 20, fat: 5, carbs: 0 })).toBeNull()
    expect(kcalMismatch({ kcal: 500, protein: 20, fat: Number.NaN, carbs: 0 })).toBeNull()
  })
})

describe('recipeMacrosPer100g', () => {
  const components = [
    { food: rice, quantity: 100 },     // 360 kcal
    { food: chicken, quantity: 200 }   // 240 kcal
  ]

  it('spreads component macros across the finished weight', () => {
    // 600 kcal total over a 600g finished dish = 100 kcal per 100g.
    const per100 = recipeMacrosPer100g(components, 600)
    expect(approx(per100)).toEqual({
      kcal: 100, protein: 8.8333, fat: 1.0333, carbs: 13.1667
    })
  })

  it('lets a portion of the recipe be logged by weighing the plate', () => {
    const per100 = recipeMacrosPer100g(components, 600)
    // A 300g plate is half the dish, so half the calories.
    expect(resolveMacros(per100, 300).kcal).toBeCloseTo(300, 6)
  })

  it('returns zeroes when the yield weight is missing or zero', () => {
    const zero = { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    expect(recipeMacrosPer100g(components, 0)).toEqual(zero)
    expect(recipeMacrosPer100g(components, Number.NaN)).toEqual(zero)
  })

  it('adds the components up as a starting point for the finished weight', () => {
    expect(recipeComponentsWeight(components)).toBeCloseTo(300, 6)
  })
})

describe('goals', () => {
  it('splits a kcal target into macro grams by percentage of energy', () => {
    const goal = goalsFromPercent(2000, { protein: 30, fat: 30, carbs: 40 })
    expect(approx(goal)).toEqual({
      kcal: 2000, protein: 150, fat: 66.6667, carbs: 200
    })
    expect(kcalFromMacros(goal)).toBeCloseTo(2000, 6)
  })

  it('round-trips grams back to percentages', () => {
    const pct = { protein: 35, fat: 25, carbs: 40 }
    const back = goalsToPercent(goalsFromPercent(2400, pct))
    expect(back.protein).toBeCloseTo(35, 6)
    expect(back.fat).toBeCloseTo(25, 6)
    expect(back.carbs).toBeCloseTo(40, 6)
  })

  it('derives percentages from the macros themselves when no kcal goal is set', () => {
    const pct = goalsToPercent({ kcal: 0, protein: 100, fat: 50, carbs: 100 })
    // 400 + 450 + 400 = 1250 kcal implied.
    expect(pct.protein).toBeCloseTo(32, 6)
    expect(pct.fat).toBeCloseTo(36, 6)
    expect(pct.carbs).toBeCloseTo(32, 6)
  })

  it('reports zeroes rather than dividing by zero on an empty goal', () => {
    expect(goalsToPercent({ kcal: 0, protein: 0, fat: 0, carbs: 0 }))
      .toEqual({ protein: 0, fat: 0, carbs: 0 })
  })
})

describe('dayTotals', () => {
  const macros = (kcal: number): Macros => ({ kcal, protein: 1, fat: 1, carbs: 1 })

  it('sums every counted row', () => {
    const totals = dayTotals([
      { counted: true, macros: macros(500) },
      { counted: true, macros: macros(300) },
      { counted: true, macros: macros(700) }
    ])
    expect(totals.total.kcal).toBe(1500)
    expect(totals.total.protein).toBe(3)
    expect(totals.hasIncomplete).toBe(false)
  })

  it('excludes uncounted rows from the total', () => {
    const totals = dayTotals([
      { counted: true, macros: macros(500) },
      { counted: false, macros: macros(900) }
    ])
    expect(totals.total.kcal).toBe(500)
  })

  it('flags counted rows that still have no macros', () => {
    const totals = dayTotals([
      { counted: true, macros: macros(500) },
      { counted: true, macros: null }
    ])
    expect(totals.total.kcal).toBe(500)
    expect(totals.hasIncomplete).toBe(true)
  })

  it('does not flag an uncounted row that has no macros', () => {
    const totals = dayTotals([{ counted: false, macros: null }])
    expect(totals.hasIncomplete).toBe(false)
  })

  it('returns zeroes for an empty day', () => {
    const totals = dayTotals([])
    expect(totals.total).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 })
  })
})

describe('remaining and warnings', () => {
  const goal: Macros = { kcal: 2000, protein: 150, fat: 67, carbs: 200 }

  it('goes negative once a macro is over', () => {
    const rest = remainingMacros(goal, { kcal: 2200, protein: 100, fat: 50, carbs: 150 })
    expect(rest.kcal).toBe(-200)
    expect(rest.protein).toBe(50)
  })

  it('names only the macros that are over', () => {
    expect(exceededMacros(goal, { kcal: 2200, protein: 100, fat: 80, carbs: 150 }))
      .toEqual(['kcal', 'fat'])
  })

  it('never flags a macro whose goal is unset', () => {
    const partial: Macros = { kcal: 2000, protein: 150, fat: 0, carbs: 0 }
    expect(exceededMacros(partial, { kcal: 100, protein: 10, fat: 999, carbs: 999 }))
      .toEqual([])
  })

  it('treats hitting the goal exactly as not exceeded', () => {
    expect(exceededMacros(goal, goal)).toEqual([])
  })

  it('lets a day run a little past a goal without flagging it', () => {
    // 2% over on every macro: the shape of an ordinary day, not a warning.
    expect(exceededMacros(goal, { kcal: 2040, protein: 153, fat: 68, carbs: 204 }))
      .toEqual([])
  })

  it('flags what runs past the goal by more than the tolerance', () => {
    expect(isOverGoal(2000 * (1 + GOAL_TOLERANCE), 2000)).toBe(false)
    expect(isOverGoal(2000 * (1 + GOAL_TOLERANCE) + 1, 2000)).toBe(true)
  })

  it('never flags against a goal of zero, however large the total', () => {
    expect(isOverGoal(999, 0)).toBe(false)
  })
})
