/**
 * Human-like mouse/click wrapper for Camofox HTTP API.
 *
 * Camofox /click supports ref-based clicks but not Bezier mouse trajectories.
 * This wrapper adds pre-click hover dwell and post-click stability wait
 * to approximate human behavior.
 *
 * Reference: SocialOps scripts/playwrightRunnerHelpers/humanMouse.mjs
 */

import { sleep, waitAfterClick, randInt } from './timing.js'
import type { CamofoxClient } from '../camofox/client.js'

interface HumanClickOptions {
  hoverBeforeMs?: [number, number] // [min, max] ms hover dwell before click
  doubleClick?: boolean
}

/**
 * Click an element (by ref or selector) with a pre-click hover pause
 * and post-click stability wait.
 */
export async function humanClick(
  client: CamofoxClient,
  tabId: string,
  userId: string,
  elementRef: string,
  options: HumanClickOptions = {},
): Promise<void> {
  const { hoverBeforeMs = [80, 250], doubleClick = false } = options

  // Pre-click hover dwell
  await sleep(randInt(hoverBeforeMs[0], hoverBeforeMs[1]))

  // Detect if elementRef is a CSS selector
  const isCssSelector = /[\[\]().#:]/.test(elementRef)

  await client.click(tabId, {
    userId,
    ref: isCssSelector ? undefined : elementRef,
    selector: isCssSelector ? elementRef : undefined,
    doubleClick,
  })

  // Post-click stability wait
  await waitAfterClick()
}

/**
 * Click using explicit coordinates (for cases where we compute bbox center).
 */
export async function humanClickAt(
  client: CamofoxClient,
  tabId: string,
  userId: string,
  x: number,
  y: number,
): Promise<void> {
  await sleep(randInt(80, 250))
  await client.click(tabId, {
    userId,
    coordinates: { x, y },
  })
  await waitAfterClick()
}
