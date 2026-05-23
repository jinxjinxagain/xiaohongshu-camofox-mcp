/**
 * Human-like keyboard input wrapper for Camofox HTTP API.
 *
 * Camofox /type sends all text in one request. To approximate human rhythm
 * we chunk text into words/tokens and send them with inter-token pauses.
 * Per-character typo simulation is deferred to Phase 2 when/if Camofox
 * gains a true `human_type` endpoint.
 *
 * Reference: SocialOps scripts/playwrightRunnerHelpers/humanKeyboard.mjs
 */

import { sleep, thinkPause, randInt } from './timing.js'
import type { CamofoxClient } from '../camofox/client.js'

interface HumanTypeOptions {
  clear?: boolean
  submit?: boolean
  chunkDelayMs?: [number, number] // [min, max] ms between chunks
}

/**
 * Type text into the element identified by `ref` or `selector` with
 * human-like inter-token pauses.
 */
export async function humanType(
  client: CamofoxClient,
  tabId: string,
  userId: string,
  text: string,
  elementRef: string,
  options: HumanTypeOptions = {},
): Promise<void> {
  const { clear = true, submit = false, chunkDelayMs = [200, 400] } = options

  // Split into words/punctuation tokens
  const tokens = tokenize(text)
  let charsSincePause = 0

  for (const token of tokens) {
    // Pass as selector if elementRef looks like a CSS selector (contains CSS-specific chars)
    const isCssSelector = /[\[\]().#:]/.test(elementRef)
    await client.type(tabId, {
      userId,
      ref: isCssSelector ? undefined : elementRef,
      selector: isCssSelector ? elementRef : undefined,
      text: token.text,
      clear: charsSincePause === 0 ? clear : false,
    })

    charsSincePause += token.text.length

    // Longer pause after punctuation
    if (/[.!?]/.test(token.trailing)) {
      await sleep(randInt(400, 800))
    } else if (/[,;:]/.test(token.trailing)) {
      await sleep(randInt(200, 300))
    }

    // Inter-word pause
    if (token.trailing || token.text.length > 0) {
      const [min, max] = chunkDelayMs
      await sleep(randInt(min, max))
    }

    // Periodic think pause to simulate "thinking"
    if (charsSincePause >= randInt(10, 25)) {
      await thinkPause()
      charsSincePause = 0
    }
  }

  if (submit) {
    await client.type(tabId, { userId, ref: elementRef, text: '\n' })
  }
}

interface Token {
  text: string
  trailing: string
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    let wordEnd = i
    while (wordEnd < text.length && /[a-zA-Z0-9']/.test(text[wordEnd])) {
      wordEnd++
    }
    const word = text.slice(i, wordEnd)
    let trailingEnd = wordEnd
    while (trailingEnd < text.length && !/[a-zA-Z0-9']/.test(text[trailingEnd])) {
      trailingEnd++
    }
    const trailing = text.slice(wordEnd, trailingEnd)
    if (word || trailing) tokens.push({ text: word, trailing })
    i = trailingEnd
    if (i === wordEnd && i === text.length) break
  }
  return tokens
}
