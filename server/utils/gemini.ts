/**
 * The one place that talks to Gemini — and the one place that remembers what it
 * said, so that the same question is only ever paid for once.
 *
 * Everything here is about the transport — the key, the URL, pulling the answer
 * out of the envelope, and the cache in front of it. What is worth asking
 * about, and what to do with the reply, belongs to the endpoint that asks.
 */

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * How long an answer is waited for.
 *
 * A dialog is open while this runs, so this is a patience budget rather than a
 * network one: a lookup that answers at all answers in a couple of seconds, and
 * a person who has waited eight for a suggestion they did not ask for would
 * rather have the form back. Everything past here is a hang, and waiting longer
 * on a hang buys nothing.
 */
const TIMEOUT_MS = 8_000

/** Assumed pause after a rate limit that does not say how long to wait for. */
const DEFAULT_PAUSE_MS = 60_000

/** The longest a rate limit is honoured for before the model is tried again. */
const MAX_PAUSE_MS = 5 * 60_000

/**
 * How long a remembered "nothing usable" stands before the model is given
 * another chance.
 *
 * A blank answer is worth caching — a name the model has nothing to say about
 * is asked about repeatedly, and each of those asks costs the same as a real
 * one. But blank is also what a momentary safety block or a truncated reply
 * looks like, and a permanent one would mean a food that can never be looked up
 * again. Answers themselves never expire: a food composition table does not
 * change its mind.
 */
const EMPTY_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * When the model may be spoken to again, after it said it was over its limit.
 *
 * A quota is not a property of one question: once Google has refused on the
 * grounds that too much was asked, every question in the next minute gets the
 * same answer. Without this each of them still costs a round trip and a wait in
 * front of somebody's open dialog, which is the slowest possible way to learn
 * something already known. Per process, and forgotten on restart — an
 * optimistic process just spends one request to find out.
 */
let pausedUntil = 0

export interface GeminiJsonRequest {
  /** Standing instructions: who the model is answering as. */
  system: string
  /** The question itself. */
  prompt: string
  /** JSON Schema the answer is made to fit, so it never has to be scraped. */
  schema: Record<string, unknown>
}

/** Whether suggestions can be asked for at all. */
export function geminiConfigured(): boolean {
  return Boolean(geminiKey())
}

function geminiKey(): string {
  const raw = process.env.NUXT_GEMINI_API_KEY || useRuntimeConfig().gemini.apiKey
  // A key pasted into a hosting dashboard or an env file arrives surprisingly
  // often with a newline or a pair of quotes still attached. Google reads that
  // as a different key and rejects it with a 400, which reads like the request
  // was malformed rather than the secret.
  return raw.trim().replace(/^(["'])(.*)\1$/, '$2').trim()
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string, thought?: boolean }> }
  }>
}

/**
 * Ask Gemini a question whose answer is JSON, and hand back that JSON parsed.
 *
 * Answered from the database whenever the identical question has been asked
 * before, including when the answer that time was nothing at all.
 *
 * Throws for anything that is not a usable answer — no key, a refusal, a reply
 * that will not parse. Callers decide what an unavailable suggestion means to
 * them; here it is simply an error.
 */
export async function generateJson<T>(request: GeminiJsonRequest): Promise<T> {
  const key = geminiKey()
  if (!key) throw new Error('NUXT_GEMINI_API_KEY is not set')

  const model = useRuntimeConfig().gemini.model || 'gemini-3.5-flash-lite'
  const hash = requestHash(model, request)

  const remembered = await readCache(hash)
  if (remembered) {
    if (remembered.answer === null) throw new Error('Gemini returned nothing (remembered)')
    return remembered.answer as T
  }

  if (Date.now() < pausedUntil) {
    throw new Error(`Gemini is over its limit; not asking again for ${Math.ceil((pausedUntil - Date.now()) / 1000)}s`)
  }

  const response = await askGemini(model, key, request)

  // The model's own reasoning comes back as parts flagged `thought`, which are
  // not part of the answer and are not JSON.
  const text = (response.candidates?.[0]?.content?.parts ?? [])
    .filter(part => !part.thought && typeof part.text === 'string')
    .map(part => part.text)
    .join('')

  const answer = parseAnswer<T>(text)

  // Written before the throw, so that a question the model has no answer to is
  // asked once rather than on every attempt.
  await writeCache(hash, model, request.prompt, answer)

  if (answer === null) throw new Error('Gemini returned nothing usable')
  return answer
}

/**
 * The answer, or null for a reply that carried none.
 *
 * Empty text and text that is not JSON are the same outcome to a caller — there
 * is no answer — and both are the model's doing rather than a network's, so
 * both are worth remembering rather than retrying.
 */
function parseAnswer<T>(text: string): T | null {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * What identifies a request: everything that could change the answer.
 *
 * The instructions and the schema are in here alongside the question, so that
 * editing a prompt asks afresh instead of serving an answer given under the old
 * one. Hashed rather than stored whole because the key is an index, and the
 * system prompt is a page long.
 */
function requestHash(model: string, request: GeminiJsonRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([model, request.system, request.prompt, request.schema]))
    .digest('hex')
}

/**
 * The remembered answer, or undefined if there is none to use.
 *
 * A cache that is down must not take suggestions down with it, so a failure
 * here reads as a miss and costs one lookup.
 */
async function readCache(hash: string): Promise<{ answer: unknown } | undefined> {
  try {
    const [row] = await useDb()
      .select()
      .from(tables.geminiCache)
      .where(eq(tables.geminiCache.requestHash, hash))
      .limit(1)

    if (!row) return undefined
    if (row.response === null && Date.now() - row.createdAt.getTime() > EMPTY_TTL_MS) return undefined

    return { answer: row.response }
  } catch (e) {
    console.error('[gemini] cache read failed', (e as Error).message)
    return undefined
  }
}

/**
 * Remember an answer — including the absence of one.
 *
 * Upserted rather than inserted: two dialogs opening on the same blank food at
 * once both arrive here, and an expired blank is being replaced by a fresh
 * attempt. The answer already exists either way, so nothing is worth failing a
 * request over.
 */
async function writeCache(hash: string, model: string, prompt: string, answer: unknown): Promise<void> {
  try {
    await useDb()
      .insert(tables.geminiCache)
      .values({ requestHash: hash, model, prompt, response: answer })
      .onConflictDoUpdate({
        target: tables.geminiCache.requestHash,
        set: { model, prompt, response: answer, createdAt: new Date() }
      })
  } catch (e) {
    console.error('[gemini] cache write failed', (e as Error).message)
  }
}

/**
 * The request itself, with whatever Google objected to carried out in the
 * error.
 *
 * ofetch's own message is the status line and nothing else — "400 Bad Request"
 * in a production log is indistinguishable between a rejected key and a
 * malformed body, and neither is worth a retry. Google says which in the
 * response body, so that is what is raised.
 *
 * Nothing that fails here is written to the cache: a timeout or a rate limit
 * says nothing about the question, and remembering one would turn a bad minute
 * into a permanently unanswerable food.
 */
async function askGemini(model: string, key: string, request: GeminiJsonRequest): Promise<GeminiResponse> {
  try {
    return await $fetch<GeminiResponse>(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key },
      // Someone is watching a spinner: one attempt is what there is time for,
      // and the errors worth retrying — a rate limit, an overloaded model — are
      // exactly the ones a retry a millisecond later runs into again.
      retry: 0,
      // A lookup, not a puzzle: the least thinking the model offers is plenty,
      // and it is what keeps the wait short enough to sit inside a dialog.
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
          thinkingConfig: { thinkingLevel: 'low' }
        }
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (e) {
    // ofetch hands back a FetchError whose message is the status line, so the
    // timeout is only recognisable underneath it — and a wait that ran out is
    // worth saying plainly, since it is the one failure that is not Google's.
    const cause = (e as { cause?: { name?: string } }).cause
    if (cause?.name === 'TimeoutError' || (e as Error).name === 'TimeoutError') {
      throw new Error(`Gemini did not answer within ${TIMEOUT_MS / 1000}s`)
    }

    const error = (e as GoogleError).data?.error
    if (!error?.message) throw e

    if (error.status === 'RESOURCE_EXHAUSTED') pause(error)

    throw new Error(`Gemini ${error.status ?? 'error'}: ${error.message}`)
  }
}

interface GoogleError {
  data?: {
    error?: {
      status?: string
      message?: string
      details?: Array<{ '@type'?: string, retryDelay?: string }>
    }
  }
}

/**
 * Stop asking until the limit Google named has passed.
 *
 * Google says when to come back — as a RetryInfo detail, and in the message
 * itself when it does not. Both are believed only within reason: a daily free
 * quota can name a wait of hours, and a process that trusts that answers "no"
 * to everything for the rest of the afternoon even after billing is turned on.
 */
function pause(error: NonNullable<GoogleError['data']>['error']): void {
  const detail = error?.details?.find(d => typeof d.retryDelay === 'string')?.retryDelay
  const fromMessage = error?.message?.match(/retry in ([\d.]+)s/i)?.[1]
  const seconds = Number.parseFloat(detail ?? fromMessage ?? '')

  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_PAUSE_MS
  pausedUntil = Date.now() + Math.min(wait, MAX_PAUSE_MS)
}
