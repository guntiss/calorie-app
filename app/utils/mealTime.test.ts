import { describe, expect, it } from 'vitest'
import { mealForSlot, mealSlotAt } from './mealTime'

const at = (hour: number, minute = 0) => new Date(2026, 0, 1, hour, minute)

describe('mealSlotAt', () => {
  it('reads the main meals off the clock', () => {
    expect(mealSlotAt(at(7))).toBe('breakfast')
    expect(mealSlotAt(at(12, 30))).toBe('lunch')
    expect(mealSlotAt(at(19))).toBe('dinner')
  })

  it('puts the gaps between meals down as snacks', () => {
    expect(mealSlotAt(at(16))).toBe('snack')
    expect(mealSlotAt(at(22))).toBe('snack')
    expect(mealSlotAt(at(2))).toBe('snack')
  })

  it('starts each slot on the hour', () => {
    expect(mealSlotAt(at(3, 59))).toBe('snack')
    expect(mealSlotAt(at(4))).toBe('breakfast')
    expect(mealSlotAt(at(10, 59))).toBe('breakfast')
    expect(mealSlotAt(at(11))).toBe('lunch')
    expect(mealSlotAt(at(15))).toBe('snack')
    expect(mealSlotAt(at(17))).toBe('dinner')
    expect(mealSlotAt(at(21))).toBe('snack')
  })
})

describe('mealForSlot', () => {
  const meals = [
    { id: 'a', name: 'Breakfast' },
    { id: 'b', name: 'Lunch' },
    { id: 'c', name: 'Supper' },
    { id: 'd', name: 'Late snacks' }
  ]

  it('matches on the name, whatever the case or wording around it', () => {
    expect(mealForSlot(meals, 'breakfast')?.id).toBe('a')
    expect(mealForSlot(meals, 'lunch')?.id).toBe('b')
    expect(mealForSlot(meals, 'dinner')?.id).toBe('c')
    expect(mealForSlot(meals, 'snack')?.id).toBe('d')
  })

  it('finds nothing for a meal the user does not have', () => {
    expect(mealForSlot([{ name: 'Fuel' }], 'lunch')).toBeUndefined()
  })
})
