import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../database/schema'

/**
 * The cache is the whole point of this module, so what is tested is what it
 * costs: which questions reach Google, and which are answered from the row that
 * a previous one left behind.
 *
 * Nitro's auto-imports are globals at runtime, so they are globals here too —
 * a stub database that records what it was asked to write, and a stub fetch
 * that stands in for Google. The module is re-imported per test because the
 * pause a rate limit buys is module state, and one test's spent quota is not
 * the next one's.
 */

interface CacheRow {
  requestHash: string
  model: string
  prompt: string
  response: unknown
  createdAt: Date
}

let generateJson: typeof import('./gemini').generateJson
let stored: CacheRow[]
let written: CacheRow[]
let readFails: boolean
let fetchCalls: number
let reply: () => unknown

const REQUEST = {
  system: 'You are a nutrition reference.',
  prompt: 'Food: quinoa, boiled',
  schema: { type: 'object', properties: { kcal: { type: 'number' } } }
}

/** A Gemini envelope carrying `text` as the answer, alongside a thought part. */
function envelope(text: string) {
  return {
    candidates: [{
      content: {
        parts: [
          { text: 'weighing this up', thought: true },
          { text }
        ]
      }
    }]
  }
}

/** A rate limit as ofetch surfaces it: Google's body hanging off `data`. */
function quotaError(retryDelay: string) {
  const error = new Error('[POST] "...": 429 Too Many Requests')
  return Object.assign(error, {
    name: 'FetchError',
    data: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota.',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]
      }
    }
  })
}

beforeEach(async () => {
  stored = []
  written = []
  readFails = false
  fetchCalls = 0
  reply = () => envelope(JSON.stringify({ kcal: 120 }))

  process.env.NUXT_GEMINI_API_KEY = 'test-key'

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (readFails) return Promise.reject(new Error('cache unreachable'))
            return Promise.resolve(stored)
          }
        })
      })
    }),
    insert: () => ({
      values: (row: Omit<CacheRow, 'createdAt'>) => ({
        onConflictDoUpdate: () => {
          written.push({ ...row, createdAt: new Date() })
          return Promise.resolve()
        }
      })
    })
  }

  Object.assign(globalThis, {
    tables: schema,
    useDb: () => db,
    useRuntimeConfig: () => ({ gemini: { apiKey: 'test-key', model: 'gemini-test' } }),
    $fetch: vi.fn(() => {
      fetchCalls++
      return Promise.resolve(reply())
    })
  })

  vi.resetModules()
  ;({ generateJson } = await import('./gemini'))
})

describe('generateJson', () => {
  it('asks Gemini when nothing is remembered, and remembers the answer', async () => {
    const answer = await generateJson<{ kcal: number }>(REQUEST)

    expect(answer).toEqual({ kcal: 120 })
    expect(fetchCalls).toBe(1)
    expect(written).toHaveLength(1)
    expect(written[0]!.response).toEqual({ kcal: 120 })
    expect(written[0]!.prompt).toBe(REQUEST.prompt)
    expect(written[0]!.model).toBe('gemini-test')
  })

  it('answers from the cache without asking Gemini', async () => {
    stored = [{ requestHash: 'x', model: 'gemini-test', prompt: REQUEST.prompt, response: { kcal: 99 }, createdAt: new Date() }]

    await expect(generateJson(REQUEST)).resolves.toEqual({ kcal: 99 })
    expect(fetchCalls).toBe(0)
  })

  it('remembers an empty answer rather than paying for it again', async () => {
    reply = () => envelope('   ')

    await expect(generateJson(REQUEST)).rejects.toThrow(/nothing usable/)
    expect(written).toHaveLength(1)
    expect(written[0]!.response).toBeNull()
  })

  it('remembers an answer that will not parse', async () => {
    reply = () => envelope('sorry, I cannot help with that')

    await expect(generateJson(REQUEST)).rejects.toThrow(/nothing usable/)
    expect(written[0]!.response).toBeNull()
  })

  it('serves a remembered empty answer without asking again', async () => {
    stored = [{ requestHash: 'x', model: 'gemini-test', prompt: REQUEST.prompt, response: null, createdAt: new Date() }]

    await expect(generateJson(REQUEST)).rejects.toThrow(/remembered/)
    expect(fetchCalls).toBe(0)
  })

  it('gives the model another chance once a remembered empty answer is stale', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    stored = [{ requestHash: 'x', model: 'gemini-test', prompt: REQUEST.prompt, response: null, createdAt: eightDaysAgo }]

    await expect(generateJson(REQUEST)).resolves.toEqual({ kcal: 120 })
    expect(fetchCalls).toBe(1)
  })

  it('never remembers a request that failed on the way out', async () => {
    reply = () => { throw new Error('network down') }

    await expect(generateJson(REQUEST)).rejects.toThrow()
    expect(written).toHaveLength(0)
  })

  it('still answers when the cache itself is down', async () => {
    readFails = true

    await expect(generateJson(REQUEST)).resolves.toEqual({ kcal: 120 })
    expect(fetchCalls).toBe(1)
  })

  it('stops asking once Google says the quota is spent', async () => {
    reply = () => { throw quotaError('29.5s') }

    await expect(generateJson(REQUEST)).rejects.toThrow(/RESOURCE_EXHAUSTED/)
    expect(fetchCalls).toBe(1)

    // A different food, so nothing is answering this from the cache.
    await expect(generateJson({ ...REQUEST, prompt: 'Food: rice' })).rejects.toThrow(/over its limit/)
    expect(fetchCalls).toBe(1)
  })

  it('still serves remembered answers while the quota is spent', async () => {
    reply = () => { throw quotaError('29.5s') }
    await expect(generateJson(REQUEST)).rejects.toThrow(/RESOURCE_EXHAUSTED/)

    stored = [{ requestHash: 'x', model: 'gemini-test', prompt: REQUEST.prompt, response: { kcal: 77 }, createdAt: new Date() }]

    await expect(generateJson({ ...REQUEST, prompt: 'Food: oats' })).resolves.toEqual({ kcal: 77 })
    expect(fetchCalls).toBe(1)
  })

  it('says so plainly when the wait runs out', async () => {
    reply = () => {
      const error = new Error('[POST] "...": <no response> The operation was aborted due to timeout')
      Object.assign(error, { name: 'FetchError', cause: new DOMException('aborted', 'TimeoutError') })
      throw error
    }

    await expect(generateJson(REQUEST)).rejects.toThrow(/did not answer within 8s/)
    expect(written).toHaveLength(0)
  })

  it('keys on the whole request, so a changed prompt asks afresh', async () => {
    await generateJson(REQUEST)
    await generateJson({ ...REQUEST, prompt: 'Food: rice, boiled' })
    await generateJson({ ...REQUEST, system: 'You are something else.' })
    await generateJson(REQUEST)

    const hashes = written.map(row => row.requestHash)
    expect(new Set(hashes).size).toBe(3)
    expect(hashes[0]).toBe(hashes[3])
  })
})
