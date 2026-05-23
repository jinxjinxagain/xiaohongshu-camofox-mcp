/**
 * get_feed_detail MCP tool — navigate to XHS feed detail page.
 *
 * Entry: prefer from search result (click into feed), fallback to direct URL.
 * Extracts title, body, author, interactions, and comments.
 */

import { config } from '../config.js'
import { auditLog } from '../audit/log.js'
import { humanClick } from '../human/mouse.js'
import { waitAfterNavigation, waitAfterScroll, waitAfterClick } from '../human/timing.js'
import { CamofoxClient } from '../camofox/client.js'
import {
  detectLoginOrVerificationPage,
  humanScroll,
  waitForXhsStable,
  type XhsNavigationContext,
} from './navigation.js'

export interface GetFeedDetailInput {
  feed_id: string
  xsec_token?: string
  from_search_keyword?: string
  load_comments?: boolean
  max_comments?: number
  entry?: 'search_result' | 'profile' | 'direct_url'
  tabId?: string
}

export interface FeedComment {
  id: string
  user: string
  content: string
  likes?: string
  created_at?: string
}

export interface GetFeedDetailResult {
  ok: boolean
  feed_id: string
  title: string
  body: string
  author: {
    id?: string
    name?: string
    avatar?: string
  }
  interactions: {
    likes?: string
    collects?: string
    comments?: string
  }
  comments: FeedComment[]
  comments_loaded: number
  navigation_mode: 'human_path' | 'direct_url'
  finalUrl: string
  tabId: string
  actions: string[]
  login_required?: boolean
  verification_required?: boolean
  error?: string
}

/** Extract feed detail from accessibility snapshot. */
function extractFeedDetail(
  snapshot: { url?: string; accessibilityTree?: string; elements?: unknown[] },
  loadComments: boolean,
  maxComments: number,
): {
  title: string
  body: string
  author: { name?: string; id?: string }
  interactions: { likes?: string; collects?: string; comments?: string }
  comments: FeedComment[]
} {
  const tree = snapshot.accessibilityTree ?? ''
  const elements = (snapshot.elements ?? []) as Array<{
    role?: string
    name?: string
    description?: string
    properties?: Record<string, unknown>
  }>

  // Extract title
  const titleEl = elements.find(
    (el) =>
      (el.role === 'heading' || el.role === 'title') && el.name && el.name.length > 2,
  )
  const title = titleEl?.name ?? ''

  // Extract body (long text content)
  const bodyEl = elements.find(
    (el) =>
      el.role === 'StaticText' &&
      el.name &&
      el.name.length > 50 &&
      !el.name?.includes('点赞') &&
      !el.name?.includes('收藏'),
  )
  const body = bodyEl?.name ?? ''

  // Extract author
  const authorEl = elements.find(
    (el) =>
      (el.role === 'link' || el.role === 'button') &&
      (el.description?.includes('个人页') ||
        el.name?.includes('头像') ||
        el.description?.includes('author')),
  )
  const author = {
    name: authorEl?.name ?? '',
    id: (authorEl?.properties as Record<string, unknown> | undefined)?.userId as string | undefined,
  }

  // Extract interaction counts
  const extractCount = (pattern: string): string | undefined => {
    const match = tree.match(new RegExp(`${pattern}[:：]\\s*([\\d\\.]+[万千w万]?)`))
    return match?.[1]
  }

  const interactions = {
    likes: extractCount('赞'),
    collects: extractCount('收藏'),
    comments: extractCount('评论'),
  }

  // Extract comments
  const comments: FeedComment[] = []
  if (loadComments) {
    const commentEls = elements.filter(
      (el) =>
        el.role === 'link' &&
        el.name &&
        el.name.length > 3 &&
        !el.name?.includes('回复') === false, // includes 回复
    )
    for (let i = 0; i < Math.min(maxComments, commentEls.length); i++) {
      const el = commentEls[i]
      comments.push({
        id: el.properties?.id as string ?? `comment-${i}`,
        user: el.name ?? '',
        content: el.description ?? '',
      })
    }
  }

  return { title, body, author, interactions, comments }
}

export async function getFeedDetail(
  client: CamofoxClient,
  input: GetFeedDetailInput,
): Promise<GetFeedDetailResult> {
  const actions: string[] = []
  const userId = config.camofoxUserId
  const sessionKey = config.camofoxSessionKey
  const loadComments = input.load_comments ?? false
  const maxComments = input.max_comments ?? 20
  let tabId = input.tabId ?? ''
  let finalUrl = ''

  try {
    if (!tabId) {
      const tab = await client.createTab({ userId, sessionKey, trace: config.camofoxTrace })
      tabId = tab.tabId
      actions.push('create_tab')
    }

    const ctx: XhsNavigationContext = { tabId, userId, url: '' }

    // Navigate to feed detail
    const isDirect = input.entry === 'direct_url'
    if (isDirect && input.feed_id) {
      // Direct URL navigation
      const feedUrl = input.xsec_token
        ? `https://www.xiaohongshu.com/explore/${input.feed_id}?xsec_token=${input.xsec_token}`
        : `https://www.xiaohongshu.com/explore/${input.feed_id}`
      await client.navigate(tabId, { userId, url: feedUrl })
      actions.push('navigate_direct_feed')
      finalUrl = feedUrl
    } else {
      // Click from search/profile result: assume tab already on search/profile page
      // Look for the feed card in current snapshot
      const currentSnapshot = await client.snapshot(tabId, { userId })
      const { isLoginPage, isVerificationPage } = detectLoginOrVerificationPage(currentSnapshot)
      if (isLoginPage || isVerificationPage) {
        actions.push('login_or_verification')
        return {
          ok: false,
          feed_id: input.feed_id,
          title: '',
          body: '',
          author: {},
          interactions: {},
          comments: [],
          comments_loaded: 0,
          navigation_mode: 'human_path',
          finalUrl: currentSnapshot.url ?? '',
          tabId,
          actions,
          login_required: isLoginPage,
          verification_required: isVerificationPage,
        }
      }

      // Find the feed link
      const elements = currentSnapshot.elements ?? []
      const feedLink = elements.find(
        (el) =>
          el.role === 'link' &&
          el.name &&
          el.name.length > 5 &&
          !el.name?.toLowerCase().includes('search') &&
          !el.name?.toLowerCase().includes('发现') &&
          el.name.length < 200,
      )

      if (feedLink) {
        await humanClick(client, tabId, userId, feedLink.ref)
        actions.push('click_feed_from_search')
        await waitAfterClick()
        await waitAfterNavigation()
      } else if (input.feed_id) {
        // Fallback to direct URL
        const feedUrl = `https://www.xiaohongshu.com/explore/${input.feed_id}`
        await client.navigate(tabId, { userId, url: feedUrl })
        actions.push('fallback_direct_feed')
      } else {
        return {
          ok: false,
          feed_id: input.feed_id,
          title: '',
          body: '',
          author: {},
          interactions: {},
          comments: [],
          comments_loaded: 0,
          navigation_mode: 'human_path',
          finalUrl: currentSnapshot.url ?? '',
          tabId,
          actions,
          error: 'no_feed_link_found_and_no_feed_id',
        }
      }
    }

    await waitForXhsStable(client, tabId, userId)
    finalUrl = (await client.snapshot(tabId, { userId })).url ?? finalUrl

    // Light scroll to load interactions
    await humanScroll(client, ctx, 'down', 300)
    actions.push('scroll_to_interactions')
    await waitForXhsStable(client, tabId, userId)

    // If loading comments, scroll to comments section
    if (loadComments) {
      await humanScroll(client, ctx, 'down', 800)
      actions.push('scroll_to_comments')
      await waitForXhsStable(client, tabId, userId)
    }

    // Extract data
    const finalSnapshot = await client.snapshot(tabId, { userId })
    const { title, body, author, interactions, comments } = extractFeedDetail(
      finalSnapshot,
      loadComments,
      maxComments,
    )

    auditLog.append({
      tool: 'get_feed_detail',
      profile: userId,
      actions,
      navigationMode: isDirect ? 'direct_url' : 'human_path',
      resultCount: 1,
      finalUrl: finalSnapshot.url ?? finalUrl,
      tabId,
      status: 'ok',
      extra: { feed_id: input.feed_id, comments_loaded: comments.length },
    })

    return {
      ok: true,
      feed_id: input.feed_id,
      title,
      body,
      author,
      interactions,
      comments,
      comments_loaded: comments.length,
      navigation_mode: isDirect ? 'direct_url' : 'human_path',
      finalUrl: finalSnapshot.url ?? finalUrl,
      tabId,
      actions,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    actions.push('error')

    auditLog.append({
      tool: 'get_feed_detail',
      profile: userId,
      actions,
      navigationMode: 'human_path',
      resultCount: 0,
      finalUrl: finalUrl,
      tabId,
      status: 'error',
      error,
    })

    return {
      ok: false,
      feed_id: input.feed_id,
      title: '',
      body: '',
      author: {},
      interactions: {},
      comments: [],
      comments_loaded: 0,
      navigation_mode: 'human_path',
      finalUrl: finalUrl,
      tabId,
      actions,
      error,
    }
  }
}

/**
 * Simple "换线" content classifier.
 * Keywords: 换线/新线/首攀/新开/红点/定级
 * Negative patterns: 磕了很久/终于完成/个人完攀 (personal achievement)
 *
 * Edge cases:
 * - Title has positive keyword but body is short (<20 chars) or emoji-only
 *   → likely a short announcement post, count as change line
 * - Body has negative patterns → not change line (personal achievement post)
 */
export function classifyChangeLinePost(title: string, body: string): {
  is_change_line: boolean
  keywords_matched: string[]
  reason: string
} {
  const titleText = title.toLowerCase()
  const bodyText = body.toLowerCase()
  const combinedText = `${titleText} ${bodyText}`

  const positive = ['换线', '新线', '首攀', '新开', '红点', '定级', '新攀', '红线']
  const negative = ['磕了很久', '终于完成', '个人完攀', '抱石日志', '日常训练']

  const titleMatched = positive.filter((kw) => titleText.includes(kw))
  if (titleMatched.length === 0) {
    return { is_change_line: false, keywords_matched: [], reason: 'no_change_line_keywords' }
  }

  // Check negative patterns in full text
  const has_negative = negative.some((nw) => combinedText.includes(nw))
  if (has_negative) {
    return { is_change_line: false, keywords_matched: titleMatched, reason: 'negative_pattern_detected' }
  }

  // Edge case: short body (emoji/empty) + title has positive keyword → likely short announcement
  const bodyLen = body.trim().length
  if (bodyLen < 20) {
    // Count as change line if body is very short (announcement style)
    return {
      is_change_line: true,
      keywords_matched: titleMatched,
      reason: 'title_positive_short_body_likely_announcement',
    }
  }

  return {
    is_change_line: true,
    keywords_matched: titleMatched,
    reason: 'change_line_keywords_detected',
  }
}