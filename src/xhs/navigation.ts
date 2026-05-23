/**
 * XHS navigation helpers — human-like path for common XHS flows.
 *
 * Key principle: no direct URL navigation for search/profile discovery.
 * Only use direct URL when explicitly provided by caller.
 */

import { sleep, waitAfterNavigation, waitAfterClick, waitAfterScroll, thinkPause, randInt } from '../human/timing.js'
import { humanClick } from '../human/mouse.js'
import { humanType } from '../human/keyboard.js'
import type { CamofoxClient } from '../camofox/client.js'
import type { SnapshotElement } from '../camofox/types.js'

export interface XhsNavigationContext {
  tabId: string
  userId: string
  url: string
}

/** Pause to let XHS initial state load. */
export async function waitForXhsStable(client: CamofoxClient, tabId: string, userId: string): Promise<void> {
  // Wait for page to settle
  await waitAfterNavigation()
  // Try to wait for __INITIAL_STATE__ to be available
  try {
    for (let i = 0; i < 5; i++) {
      const state = await client.evaluate(
        tabId,
        `typeof window.__INITIAL_STATE__ !== 'undefined' && window.__INITIAL_STATE__ !== null`,
        userId,
      )
      if (state === true) break
      await sleep(1000)
    }
  } catch {
    // If evaluate fails, just continue
  }
}

/** Find the search box on XHS explore/home page and click it. */
export async function findAndClickSearchBox(
  client: CamofoxClient,
  ctx: XhsNavigationContext,
): Promise<SnapshotElement | null> {
  const snapshot = await client.snapshot(ctx.tabId, { userId: ctx.userId })
  // Look for search input or search button
  const searchBox = findSearchBoxElement(snapshot)
  if (searchBox) {
    await humanClick(client, ctx.tabId, ctx.userId, searchBox.ref)
    await waitAfterClick()
  }
  return searchBox
}

/** Find search box in snapshot elements. */
export function findSearchBoxElement(snapshot: { elements?: SnapshotElement[] }): SnapshotElement | null {
  const elements = snapshot.elements ?? []

  // Priority 1: explicit search input
  const input = elements.find(
    (el) =>
      el.role === 'textbox' &&
      (el.name?.includes('搜索') ||
        el.name?.includes('search') ||
        el.description?.includes('搜索') ||
        el.value?.toString().includes('搜索')),
  )
  if (input) return input

  // Priority 2: search button/link
  const btn = elements.find(
    (el) =>
      (el.role === 'button' || el.role === 'link') &&
      (el.name?.includes('搜索') ||
        el.description?.includes('搜索') ||
        el.name?.toLowerCase().includes('search')),
  )
  if (btn) return btn

  // Priority 3: search icon SVG link
  const iconLink = elements.find(
    (el) =>
      (el.role === 'link' || el.role === 'button') &&
      (el.description?.toLowerCase().includes('search') || el.name?.toLowerCase().includes('search')),
  )
  if (iconLink) return iconLink

  return null
}

/** Find a feed card element in snapshot. */
export function findFeedCard(
  snapshot: { elements?: SnapshotElement[] },
  nth = 0,
): SnapshotElement | null {
  const elements = snapshot.elements ?? []

  // Look for links that contain feed-like content
  // XHS feed items are often in links with specific attributes
  const candidates = elements.filter(
    (el) =>
      el.role === 'link' &&
      el.name &&
      el.name.length > 5 &&
      !el.name?.toLowerCase().includes('search'),
  )

  return candidates[nth] ?? null
}

/** Find author/profile link on a feed detail page. */
export function findAuthorLink(
  snapshot: { elements?: SnapshotElement[] },
): SnapshotElement | null {
  const elements = snapshot.elements ?? []

  // Look for author name link (usually on detail page)
  const author = elements.find(
    (el) =>
      (el.role === 'link' || el.role === 'button') &&
      (el.name?.includes('头像') ||
        el.description?.includes('个人页') ||
        el.name?.includes('作者') ||
        el.description?.includes('作者')),
  )
  if (author) return author

  // Fallback: look for any link near the top of the page that looks like a user
  const userLink = elements.find(
    (el) =>
      el.role === 'link' &&
      el.name &&
      !el.name?.includes('搜索') &&
      !el.name?.includes('点赞') &&
      !el.name?.includes('收藏') &&
      !el.name?.includes('评论') &&
      el.name.length > 0 &&
      el.name.length < 50,
  )
  return userLink ?? null
}

/** Find the first post card in a user profile feed. */
export function findProfilePostCard(
  snapshot: { elements?: SnapshotElement[] },
  nth = 0,
): SnapshotElement | null {
  const elements = snapshot.elements ?? []

  // Profile posts are typically link elements with image/title content
  const candidates = elements.filter(
    (el) =>
      el.role === 'link' &&
      el.name &&
      el.name.length > 3 &&
      (el.description?.includes('image') ||
        el.description?.includes('图片') ||
        el.name?.includes('的笔记') ||
        el.name?.length < 100),
  )

  return candidates[nth] ?? null
}

/** Extract feed items from search results page. */
export function extractFeedsFromSnapshot(
  snapshot: { elements?: SnapshotElement[]; accessibilityTree?: string },
  limit = 5,
): FeedItem[] {
  const elements = snapshot.elements ?? []
  const items: FeedItem[] = []

  // Try to parse from accessibility tree / __INITIAL_STATE__ first
  if (snapshot.accessibilityTree) {
    const parsed = tryParseFeedsFromTree(snapshot.accessibilityTree, limit)
    if (parsed.length > 0) return parsed
  }

  // Fallback: extract from DOM elements
  const feedLinks = elements.filter(
    (el) =>
      el.role === 'link' &&
      el.name &&
      el.name.length > 5 &&
      !el.name?.toLowerCase().includes('search') &&
      !el.name?.toLowerCase().includes('发现') === false,
  )

  for (let i = 0; i < Math.min(limit, feedLinks.length); i++) {
    const el = feedLinks[i]
    items.push({
      id: el.ref ?? `feed-${i}`,
      title: el.name ?? '',
      url: extractUrlFromElement(el),
      rank: i + 1,
    })
  }

  return items
}

export interface FeedItem {
  id: string
  title: string
  url: string
  rank: number
  user?: { id?: string; name?: string }
  xsec_token?: string
}

/** Extract URL from element properties. */
function extractUrlFromElement(el: SnapshotElement): string {
  const props = el.properties as Record<string, unknown> | undefined
  if (typeof props?.href === 'string') return props.href as string
  if (typeof props?.['data-href'] === 'string') return props['data-href'] as string
  return ''
}

/** Try to parse feeds from accessibility tree (XHS renders as text). */
function tryParseFeedsFromTree(tree: string, limit: number): FeedItem[] {
  const items: FeedItem[] = []
  // XHS accessibility tree format: user entries have patterns like "用户名 · 笔记数"
  const lines = tree.split('\n')
  let captureNext = false
  let currentTitle = ''

  for (const line of lines) {
    if (captureNext && items.length >= limit) break

    // Look for author + note count pattern (common XHS profile entry)
    const profileMatch = line.match(/^(.+?)\s*·\s*(\d+)\s*笔记/)
    if (profileMatch) {
      items.push({
        id: `profile-${items.length}`,
        title: `${profileMatch[1]} · ${profileMatch[2]}笔记`,
        url: '',
        rank: items.length + 1,
        user: { name: profileMatch[1] },
      })
      continue
    }

    // Look for feed-like titles
    if (line.trim().length > 5 && line.trim().length < 200 && !line.includes('搜索') && !line.includes('发现')) {
      if (!items.find((i) => i.title === line.trim())) {
        currentTitle = line.trim()
        captureNext = true
      }
    } else {
      captureNext = false
    }
  }

  return items.slice(0, limit)
}

/** Check if the page is showing a login/verification page. */
export function detectLoginOrVerificationPage(
  snapshot: { elements?: SnapshotElement[] },
): { isLoginPage: boolean; isVerificationPage: boolean } {
  const text = snapshot.elements
    ?.map((el) => `${el.role} ${el.name ?? ''} ${el.description ?? ''}`)
    .join(' ') ?? ''

  const isLoginPage =
    text.includes('登录') ||
    text.includes('login') ||
    text.includes('扫码') ||
    text.includes('立即登录')

  const isVerificationPage =
    text.includes('验证') ||
    text.includes('captcha') ||
    text.includes('验证中心') ||
    text.includes('账号异常')

  return { isLoginPage, isVerificationPage }
}

/** Human-like scroll on search results. */
export async function humanScroll(
  client: CamofoxClient,
  ctx: XhsNavigationContext,
  direction: 'down' | 'up' = 'down',
  amount = 500,
): Promise<void> {
  await client.scroll(ctx.tabId, {
    userId: ctx.userId,
    direction,
    amount: amount + randInt(-100, 100),
  })
  await waitAfterScroll()
}
