import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A video of a barcode, for the camera Chromium pretends to have.
 *
 * `--use-file-for-fake-video-capture` hands a Y4M file to `getUserMedia`, so
 * the scanner under test opens a camera, reads frames and decodes a real
 * EAN-13 — the whole path, rather than a stubbed detector that would prove
 * only that the dialog can be told an answer.
 *
 * The bars are drawn here rather than shipped as a fixture: the encoding is
 * forty lines and a video file is a megabyte of binary in the repository.
 */

/** The three alphabets an EAN-13 is written in. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']

/**
 * Which alphabet each of the first six digits is written in. This pattern is
 * how the thirteenth digit is carried: it has no bars of its own.
 */
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
]

/** The check digit a twelve-digit body works out to. */
export function ean13CheckDigit(body: string): string {
  const sum = [...body].reduce((total, digit, at) => total + Number(digit) * (at % 2 ? 3 : 1), 0)
  return String((10 - (sum % 10)) % 10)
}

/** A full EAN-13 as its 95 modules, '1' for a bar. */
export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error(`Not an EAN-13: ${code}`)
  if (ean13CheckDigit(code.slice(0, 12)) !== code[12]) {
    throw new Error(`Check digit is wrong for ${code}`)
  }

  const parity = PARITY[Number(code[0])]!
  const left = [...code.slice(1, 7)]
    .map((digit, at) => (parity[at] === 'L' ? L : G)[Number(digit)]!)
    .join('')
  const right = [...code.slice(7)].map(digit => R[Number(digit)]!).join('')

  return `101${left}01010${right}101`
}

const WIDTH = 640
const HEIGHT = 480
/** Frames in the file. It is looped, so this only has to outlast a frame drop. */
const FRAMES = 4

/**
 * Write the code as a Y4M the fake camera can play, and answer with the path.
 *
 * Greyscale is all a reader wants, so the colour planes are left flat and only
 * the luma plane carries the bars.
 */
export function writeBarcodeVideo(code: string, file: string): string {
  const modules = ean13Modules(code)

  // As wide as fits with a quiet zone either side — a barcode filling the frame
  // edge to edge is one no reader will touch.
  const moduleWidth = Math.floor((WIDTH * 0.75) / modules.length)
  const barsWidth = moduleWidth * modules.length
  const left = Math.floor((WIDTH - barsWidth) / 2)
  const top = Math.floor(HEIGHT * 0.25)
  const bottom = Math.floor(HEIGHT * 0.75)

  // White page, then the bars over it.
  const luma = Buffer.alloc(WIDTH * HEIGHT, 235)
  for (let x = 0; x < barsWidth; x++) {
    if (modules[Math.floor(x / moduleWidth)] !== '1') continue
    for (let y = top; y < bottom; y++) luma[y * WIDTH + left + x] = 16
  }

  // Flat chroma: neither colour, at half the resolution 4:2:0 stores it in.
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128)

  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma])
  const parts = [Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F25:1 Ip A1:1 C420\n`)]
  for (let i = 0; i < FRAMES; i++) parts.push(frame)

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.concat(parts))
  return file
}
