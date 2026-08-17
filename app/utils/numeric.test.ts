import { describe, expect, it } from 'vitest'
import { cleanNumeric, formatNumeric, parseNumeric } from './numeric'

describe('cleanNumeric', () => {
  it('takes a comma for a decimal point', () => {
    expect(cleanNumeric('1,5')).toBe('1.5')
  })

  it('leaves a half-typed decimal alone', () => {
    expect(cleanNumeric('1.')).toBe('1.')
    expect(cleanNumeric('1,')).toBe('1.')
  })

  it('keeps the first point and the digits after a second one', () => {
    expect(cleanNumeric('1.5.')).toBe('1.5')
    expect(cleanNumeric('1..5')).toBe('1.5')
    expect(cleanNumeric('1.5,2')).toBe('1.52')
  })

  it('drops anything that is not part of a number', () => {
    expect(cleanNumeric('12a')).toBe('12')
    expect(cleanNumeric('-3')).toBe('3')
    expect(cleanNumeric('1 000')).toBe('1000')
  })
})

describe('parseNumeric', () => {
  it('reads a number', () => {
    expect(parseNumeric('1.5')).toBe(1.5)
    expect(parseNumeric('0')).toBe(0)
    expect(parseNumeric('.5')).toBe(0.5)
  })

  it('reads a trailing point as the number so far', () => {
    expect(parseNumeric('1.')).toBe(1)
  })

  it('reads a field with no number in it as empty', () => {
    expect(parseNumeric('')).toBe('')
    expect(parseNumeric('.')).toBe('')
  })
})

describe('formatNumeric', () => {
  it('shows a number, and shows nothing for an absent one', () => {
    expect(formatNumeric(1.5)).toBe('1.5')
    expect(formatNumeric(0)).toBe('0')
    expect(formatNumeric('')).toBe('')
    expect(formatNumeric(null)).toBe('')
    expect(formatNumeric(undefined)).toBe('')
  })
})
