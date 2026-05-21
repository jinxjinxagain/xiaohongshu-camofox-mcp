/**
 * Randomized human-like timing utilities.
 *
 * Rules:
 * - Navigation wait: 2-5s
 * - Click post-wait: 1.5-4s
 * - Scroll pause: 1-4s
 * - Think pause: 800-2000ms
 * - Between-word pause: 200-400ms
 * - Between-char for fast tokens: 30-60ms
 * - Between-char for normal tokens: 70-140ms
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Random integer in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

/** Random float in [min, max). */
export function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Pause after navigating to a page. */
export async function waitAfterNavigation(): Promise<void> {
  await sleep(randInt(2000, 5000))
}

/** Pause after clicking an element. */
export async function waitAfterClick(): Promise<void> {
  await sleep(randInt(1500, 4000))
}

/** Pause after scrolling. */
export async function waitAfterScroll(): Promise<void> {
  await sleep(randInt(1000, 4000))
}

/** Thinking pause between words / keystroke clusters. */
export async function thinkPause(): Promise<void> {
  await sleep(randInt(800, 2000))
}

/** Cooldown enforced between MCP tool calls. */
export async function toolCooldown(minMs: number, maxMs: number): Promise<void> {
  await sleep(randInt(minMs, maxMs))
}
