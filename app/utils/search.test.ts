import { describe, expect, it } from 'vitest'
import { fold, foldQuery, occurrences, placement, rangesAt, splitParts } from './search'

/** What the picker actually asks: where in `text` does `query` land? */
function ranges(text: string, query: string) {
  const hay = fold(text)
  return foldQuery(query).flatMap(term => rangesAt(hay, term, occurrences(hay, term)))
}

/** The matched stretches as they read in the source. */
function matched(text: string, query: string) {
  return ranges(text, query).map(r => text.slice(r.start, r.end))
}

describe('fold', () => {
  it('strips diacritics and case', () => {
    expect(fold('Tumšā Šokolāde').text).toBe('tumsa sokolade')
  })

  it('folds letters that carry the accent inside the codepoint', () => {
    expect(fold('Gøteborg').text).toBe('goteborg')
    expect(fold('Weißbier').text).toBe('weissbier')
  })

  it('keeps surrogate pairs whole', () => {
    expect(fold('🍎 Ābols').text).toBe('🍎 abols')
  })
})

describe('matching', () => {
  it('matches accented text typed without the accents', () => {
    expect(matched('Tumšā šokolāde', 'tumsa')).toEqual(['Tumšā'])
  })

  it('matches accented text typed with them', () => {
    expect(matched('Tumšā šokolāde', 'tumšā')).toEqual(['Tumšā'])
  })

  it('matches text that arrives already decomposed', () => {
    // The same word as above, but with the accents stored as separate marks —
    // the highlight has to swallow the marks or they hang off nothing.
    const decomposed = 'Tumšā'.normalize('NFD')
    expect(matched(decomposed, 'tumsa')).toEqual([decomposed])
  })

  it('finds every occurrence', () => {
    expect(matched('Piena piens', 'pien')).toEqual(['Pien', 'pien'])
  })

  it('takes each word of the query separately', () => {
    expect(matched('Tumšā šokolāde', 'sok tums')).toEqual(['šok', 'Tumš'])
  })

  it('does not match what is not there', () => {
    expect(matched('Tumšā šokolāde', 'piens')).toEqual([])
  })
})

describe('placement', () => {
  const rank = (text: string, term: string) => {
    const hay = fold(text)
    return placement(hay, occurrences(hay, term))
  }

  it('ranks the start of the text first', () => {
    expect(rank('Milk, whole', 'milk')).toBe(0)
  })

  it('ranks the start of a later word next', () => {
    expect(rank('Oat milk', 'milk')).toBe(1)
  })

  it('ranks a match inside a word last', () => {
    expect(rank('Buttermilk', 'milk')).toBe(2)
  })

  it('takes the best occurrence when there are several', () => {
    expect(rank('Buttermilk, milk based', 'milk')).toBe(1)
  })
})

describe('splitParts', () => {
  it('cuts the text into matched and unmatched runs', () => {
    expect(splitParts('Tumšā šokolāde', ranges('Tumšā šokolāde', 'tumsa')))
      .toEqual([
        { text: 'Tumšā', match: true },
        { text: ' šokolāde', match: false }
      ])
  })

  it('joins overlapping matches so nothing is highlighted twice', () => {
    expect(splitParts('Piens', ranges('Piens', 'pie iens'))).toEqual([
      { text: 'Piens', match: true }
    ])
  })

  it('leaves text with no matches in one piece', () => {
    expect(splitParts('Piens', [])).toEqual([{ text: 'Piens', match: false }])
  })
})
