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
  // XHS accessibility snapshot returns 0 elements — the tree is in the raw text.
  // Read both: elements[] (empty on XHS) and snapshot/accessibilityTree (populated).
  const snapshot = await client.snapshot(ctx.tabId, { userId: ctx.userId })
  const rawTree = snapshot.accessibilityTree ?? ''
  const elements = snapshot.elements ?? []

  // Priority 1: parse raw text snapshot for XHS search textbox
  // XHS uses "搜索小红书" or "登录探索更多内容" as the search box name
  const textboxMatch = rawTree.match(/textbox\s+"([^"]*(?:搜索|探索)[^"]*)"\s+\[([^\]]+)\]:?/)
  if (textboxMatch) {
    const ref = textboxMatch[2]
    try {
      await client.click(ctx.tabId, { userId: ctx.userId, ref })
      await waitAfterClick()
      return { ref, role: 'textbox', name: textboxMatch[1] }
    } catch (err) {
      // Click timed out — let the caller use fallback direct URL navigation
      console.error(`[findAndClickSearchBox] click "${textboxMatch[1]}" timed out: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Priority 2: accessibility elements (fallback for non-XHS pages)
  const searchBox = findSearchBoxElement({ elements })
  if (searchBox) {
    try {
      await humanClick(client, ctx.tabId, ctx.userId, searchBox.ref)
      await waitAfterClick()
      return searchBox
    } catch (err) {
      console.error(`[findAndClickSearchBox] Priority-2 click timed out: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Priority 3: CSS selector fallback (only for non-XHS or hybrid pages)
  const cssSelectors = [
    'input[placeholder*="搜索"]',
    'input[placeholder*="search"]',
    'input[placeholder*="Search"]',
    '[data-vane="search-input"]',
    '.search-input input',
    'header input[type="search"]',
    '[class*="search"] input',
    '[class*="Search"] input',
    'input[type="search"]',
    'input[aria-label*="搜索"]',
  ]

  for (const selector of cssSelectors) {
    try {
      const found = await client.evaluate(
        ctx.tabId,
        `(() => {
          const el = document.querySelector('${selector}')
          if (el) { el.focus(); return true }
          return false
        })()`,
        ctx.userId,
      )
      if (found === true) {
        await client.click(ctx.tabId, { userId: ctx.userId, selector })
        await waitAfterClick()
        return { ref: selector, role: 'textbox', name: 'search-input' }
      }
    } catch (err) {
      console.error(`[findAndClickSearchBox] selector "${selector}" failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Log what we actually have for debugging
  const elNames = elements.map((el) => `${el.role} "${el.name ?? ''}"`).slice(0, 20)
  console.error(`[findAndClickSearchBox] No search box found. elements=${elements.length}, treeLen=${rawTree.length}`)
  if (elNames.length) console.error(`  elements:`, elNames)

  return null
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
      el.name.length < 200 &&
      !el.name?.toLowerCase().includes('search') &&
      !el.name?.toLowerCase().includes('发现'),
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

/** Try to parse feeds from accessibility tree / raw text snapshot.
 *
 * Camofox XHS snapshot format:
 *   - link [eN]:           ← note link (has URL but NO title text)
 *     - /url: /search_result/NOTE_ID
 *     - img
 *   - link "TITLE" [eN]: ← title link (has title but URL is in NEXT entry's /url)
 *   - link [eN]:
 *     - /url: /search_result/NOTE_ID
 *     - img
 *   - link "TITLE" [eN]: ← title link
 *     - img
 *
 * Pattern: `[eN]:` followed by `  - /url: /search_result/...` = note link.
 * Previous non-empty non-image text = title candidate.
 */
function tryParseFeedsFromTree(tree: string, limit: number): FeedItem[] {
  const lines = tree.split('\n')
  const items: FeedItem[] = []

  let lastTitle = ''
  for (let i = 0; i < lines.length && items.length < limit; i++) {
    const line = lines[i]

    // Capture non-empty text that looks like a feed title (between image lines)
    const textMatch = line.match(/^\s*-\s*text:\s*"([^"]+)"\s*$/)
    if (textMatch) {
      lastTitle = textMatch[1]
      continue
    }

    // Skip image lines and empty links
    const imgMatch = line.match(/^\s*-\s*img\s*$/)
    const emptyLinkMatch = line.match(/^\s*-\s*link\s+\[([^\]]+)\]:\s*$/)
    if (imgMatch || emptyLinkMatch) continue

    // Match: link "TITLE" [eN]: — this is the title-bearing link
    const linkMatch = line.match(/^\s*-\s*link\s+"([^"]+)"\s+\[([^\]]+)\]:\s*$/)
    if (!linkMatch) continue
    const title = linkMatch[1].trim()
    const ref = linkMatch[2]

    // The URL for this link is in the NEXT entry (note link without title)
    const url = extractUrlFromTreeLines(lines, i + 1)

    // Skip nav/footer/generic links
    if (
      title.includes('搜索') ||
      title.includes('发现') ||
      title.includes('直播') ||
      title.includes('发布') ||
      title.includes('通知') ||
      title.includes('创作中心') ||
      title.includes('赞') ||
      title.includes('收藏') ||
      title.includes('评论') ||
      title.length < 3 ||
      title.length > 200
    ) {
      continue
    }

    // Check if next lines contain a note URL (not profile URL)
    const noteUrlMatch = extractUrlFromTreeLines(lines, i + 1)
    if (!noteUrlMatch || !noteUrlMatch.includes('/search_result/')) continue

    items.push({
      id: ref,
      title,
      url: noteUrlMatch,
      rank: items.length + 1,
    })
  }

  // Deduplicate by note ID
  const seen = new Set<string>()
  return items.filter((item) => {
    const noteId = item.url.split('/search_result/')[1]?.split('?')[0] ?? item.url
    if (seen.has(noteId)) return false
    seen.add(noteId)
    return true
  }).slice(0, limit)
}

/** Walk forward from current line index to find the first /url value. */
function extractUrlFromTreeLines(lines: string[], startIdx: number): string {
  for (let j = startIdx; j < Math.min(startIdx + 6, lines.length); j++) {
    const m = lines[j].match(/^\s*-\s*\/url:\s*(\S+)/)
    if (m) return m[1]
  }
  return ''
}

/** Check if a URL points to a XHS note or profile. */
function isValidXhsUrl(url: string): boolean {
  return url.startsWith('/search_result/') || url.startsWith('/user/profile/')
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
