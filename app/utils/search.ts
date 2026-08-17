/**
 * Text matching for the food picker.
 *
 * Two things the browser's own `includes` will not do, and both matter for a
 * library typed on a phone: "tumsa" has to find "tumšā", because the diacritics
 * are the first thing to go when someone is typing one-handed with a scale in
 * the other; and the list has to be able to show *where* the match landed, so a
 * screen of near-identical names can be read at a glance rather than compared
 * word by word.
 *
 * So folding keeps a map back to the source. Stripping accents shifts every
 * index after them — "tumšā" is five characters, six once decomposed — and a
 * highlight drawn at the folded offsets would sit next to the letters it means.
 */

/** Combining marks, which is what an accent becomes once decomposed. */
const COMBINING = /\p{M}/gu

/**
 * Letters that carry their accent inside the codepoint rather than as a mark,
 * so decomposing leaves them untouched. Latvian needs none of these — its
 * letters all decompose — but a library gains brands from everywhere, and
 * "Gøteborg" not answering to "goteborg" is the same complaint again.
 */
const WELDED: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  æ: 'ae',
  œ: 'oe',
  ł: 'l',
  ħ: 'h',
  ı: 'i'
}

/** A stretch of the *source* text, as character offsets into it. */
export interface MatchRange {
  start: number
  end: number
}

/**
 * Text prepared for searching, with the way back to the original alongside it.
 *
 * `starts` and `ends` are per folded character: where in the source that
 * character came from, so a hit at folded offset `i` can be drawn over the
 * letters that actually produced it.
 */
export interface FoldedText {
  text: string
  starts: number[]
  ends: number[]
}

/**
 * Lower case, accents off, and a note of where every surviving character came
 * from.
 *
 * Walked by codepoint rather than by index: a `for` over `.length` splits
 * surrogate pairs, and a food named with an emoji in it would fold into
 * garbage.
 */
export function fold(source: string): FoldedText {
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let at = 0

  for (const point of source) {
    const next = at + point.length
    const lower = point.toLowerCase()
    const plain = WELDED[lower] ?? lower.normalize('NFD').replace(COMBINING, '')

    if (plain) {
      // One source character can fold to several — ß to "ss" — and all of them
      // point back at the one character, so a hit on either half highlights it
      // whole.
      for (const ch of plain) {
        chars.push(ch)
        starts.push(at)
        ends.push(next)
      }
    } else if (ends.length) {
      // A mark that came through on its own: the source was already decomposed,
      // so the accent is a character of its own sitting after the letter it
      // belongs to. Hand it to that letter, or a highlight ending here would
      // leave the accent behind, hanging off nothing.
      ends[ends.length - 1] = next
    }

    at = next
  }

  return { text: chars.join(''), starts, ends }
}

/** A query as the words to look for, folded the same way the library is. */
export function foldQuery(query: string): string[] {
  return fold(query).text.split(/\s+/).filter(Boolean)
}

/** Folded offsets of every non-overlapping occurrence of `term`. */
export function occurrences(hay: FoldedText, term: string): number[] {
  const hits: number[] = []
  if (!term) return hits

  let from = 0
  for (;;) {
    const at = hay.text.indexOf(term, from)
    if (at === -1) return hits
    hits.push(at)
    from = at + term.length
  }
}

/** Those offsets translated back into stretches of the source text. */
export function rangesAt(hay: FoldedText, term: string, hits: number[]): MatchRange[] {
  return hits.map(at => ({
    start: hay.starts[at]!,
    end: hay.ends[at + term.length - 1]!
  }))
}

/**
 * How well a term sits in the text: 0 at the very start, 1 at the start of a
 * word, 2 buried inside one.
 *
 * This is what puts "milk" above "buttermilk" when both are typed at — someone
 * searching is nearly always naming the thing rather than its ending.
 */
export function placement(hay: FoldedText, hits: number[]): number {
  let best = 2
  for (const at of hits) {
    if (at === 0) return 0
    if (!/[\p{L}\p{N}]/u.test(hay.text[at - 1]!)) best = Math.min(best, 1)
  }
  return best
}

/** Overlapping stretches joined up, so a highlight is never drawn twice over. */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: MatchRange[] = []

  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }

  return merged
}

/** A run of text and whether the search put it there. */
export interface TextPart {
  text: string
  match: boolean
}

/** The text cut into matched and unmatched runs, ready to render. */
export function splitParts(text: string, ranges: MatchRange[]): TextPart[] {
  const parts: TextPart[] = []
  let at = 0

  for (const range of mergeRanges(ranges)) {
    if (range.start > at) parts.push({ text: text.slice(at, range.start), match: false })
    parts.push({ text: text.slice(range.start, range.end), match: true })
    at = range.end
  }

  if (at < text.length) parts.push({ text: text.slice(at), match: false })
  return parts
}
