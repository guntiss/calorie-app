/**
 * Barcodes, as they are stored on a food and looked back up from a camera.
 *
 * A barcode is not one number. The same packet answers to a 12-digit UPC-A in
 * a shop in the States and a 13-digit EAN-13 everywhere else — the same digits
 * with a zero in front — and a small packet carries the short UPC-E form, which
 * is those twelve digits with a run of zeroes squeezed out. Which of them comes
 * back is a property of the scanner and the printed symbol, not of the food, so
 * a code scanned into the library one day and scanned again the next can
 * perfectly well arrive in a different form.
 *
 * So a code is stored exactly as it was read, and a lookup asks about every
 * form of it. Nothing here is guesswork: the conversions below are the ones the
 * symbologies define.
 */

/**
 * The longest code worth keeping. EAN-13 is thirteen and a Code 128 label on a
 * shop's own packaging rarely passes twenty; the rest of the room is so that a
 * long one is stored rather than refused.
 */
export const BARCODE_MAX_LENGTH = 48

/**
 * A scanned or typed code as it should be stored, or null when there is nothing
 * there.
 *
 * Spaces go because a code read off a packet by hand is often typed in groups,
 * the way it is printed. Letters are upper-cased: Code 39 and Code 128 can
 * carry them, and the symbol has no case of its own.
 */
export function normaliseBarcode(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const code = raw.replace(/\s+/g, '').toUpperCase()
  return code ? code.slice(0, BARCODE_MAX_LENGTH) : null
}

/** Whether a code is a run of digits of the given length. */
function digitsOfLength(code: string, length: number): boolean {
  return code.length === length && /^\d+$/.test(code)
}

/**
 * UPC-E written out as the UPC-A it stands for, or null if it is not one.
 *
 * The compression is defined by the last of the six data digits, which says
 * where the zeroes it stands in for belong. Only number systems 0 and 1 have a
 * UPC-E form at all.
 */
export function expandUpcE(code: string): string | null {
  if (!digitsOfLength(code, 8)) return null

  const system = code[0]!
  if (system !== '0' && system !== '1') return null

  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7)
  const check = code[7]!

  switch (d6) {
    case '0':
    case '1':
    case '2':
      return `${system}${d1}${d2}${d6}0000${d3}${d4}${d5}${check}`
    case '3':
      return `${system}${d1}${d2}${d3}00000${d4}${d5}${check}`
    case '4':
      return `${system}${d1}${d2}${d3}${d4}00000${d5}${check}`
    default:
      return `${system}${d1}${d2}${d3}${d4}${d5}0000${d6}${check}`
  }
}

/**
 * Every form of a code that means the same packet, the scanned one first.
 *
 * This is what a lookup asks about, so that a food saved from one scanner is
 * found by another.
 */
export function barcodeVariants(raw: string): string[] {
  const code = normaliseBarcode(raw)
  if (!code) return []

  const forms = [code]
  const add = (form: string | null) => {
    if (form && !forms.includes(form)) forms.push(form)
  }

  // UPC-A and the EAN-13 that is the same code with a zero in front.
  if (digitsOfLength(code, 12)) add(`0${code}`)
  if (digitsOfLength(code, 13) && code.startsWith('0')) add(code.slice(1))

  // UPC-E, which stands for a UPC-A — and so for that EAN-13 as well.
  const expanded = expandUpcE(code)
  if (expanded) {
    add(expanded)
    add(`0${expanded}`)
  }

  return forms
}
