import { describe, expect, it } from 'vitest'
import { barcodeVariants, expandUpcE, normaliseBarcode } from './barcode'

describe('normaliseBarcode', () => {
  it('keeps a code as it was scanned', () => {
    expect(normaliseBarcode('4750001010104')).toBe('4750001010104')
  })

  it('drops the spacing a code is printed in', () => {
    expect(normaliseBarcode(' 4750 001 010104 ')).toBe('4750001010104')
  })

  it('upper-cases a code that carries letters', () => {
    expect(normaliseBarcode('abc-123')).toBe('ABC-123')
  })

  it('reads an empty field as no barcode at all', () => {
    expect(normaliseBarcode('')).toBeNull()
    expect(normaliseBarcode('   ')).toBeNull()
    expect(normaliseBarcode(null)).toBeNull()
    expect(normaliseBarcode(undefined)).toBeNull()
  })
})

describe('expandUpcE', () => {
  // One per compression, which the last data digit selects. Real codes: the
  // check digit each carries is the one its UPC-A form works out to.
  it.each([
    ['01278907', '012000007897'],
    ['04252614', '042100005264'],
    ['01234523', '012200003453'],
    ['01234531', '012300000451'],
    ['01234543', '012340000053'],
    ['05123452', '051234000052']
  ])('writes %s out as %s', (short, long) => {
    expect(expandUpcE(short)).toBe(long)
  })

  it('leaves alone what is not a UPC-E', () => {
    // Number systems other than 0 and 1 have no short form.
    expect(expandUpcE('24252614')).toBeNull()
    expect(expandUpcE('4750001010104')).toBeNull()
    expect(expandUpcE('0425261')).toBeNull()
    expect(expandUpcE('0425261A')).toBeNull()
  })
})

describe('barcodeVariants', () => {
  it('asks about the EAN-13 a UPC-A is the tail of', () => {
    expect(barcodeVariants('012345678905')).toEqual(['012345678905', '0012345678905'])
  })

  it('asks about the UPC-A inside an EAN-13 that starts with a zero', () => {
    expect(barcodeVariants('0012345678905')).toEqual(['0012345678905', '012345678905'])
  })

  it('leaves an EAN-13 of its own alone', () => {
    expect(barcodeVariants('4750001010104')).toEqual(['4750001010104'])
  })

  it('asks about both long forms of a UPC-E', () => {
    expect(barcodeVariants('04252614')).toEqual([
      '04252614',
      '042100005264',
      '0042100005264'
    ])
  })

  it('has nothing to ask about for an empty code', () => {
    expect(barcodeVariants('  ')).toEqual([])
  })
})
