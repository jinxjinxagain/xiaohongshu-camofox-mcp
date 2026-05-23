/**
 * user_profile MCP tool — navigate to XHS user profile page.
 *
 * Entry: prefer from detail page (click author), fallback to direct URL.
 * Extracts user basic info and recent feeds.
 */

import { config } from '../config.js'
import { auditLog } from '../audit/log.js'
import { humanClick } from '../human/mouse.js'
import { waitAfterNavigation, waitAfterClick } from '../human/timing.js'
import { CamofoxClient } from '../camofox/client.js'
import {
  findAuthorLink,
  findProfilePostCard,
  detectLoginOrVerificationPage,
  humanScroll,
  waitForXhsStable,
  type XhsNavigationContext,
} from './navigation.js'

export interface UserProfileInput {
  user_id?: string
  xsec_token?: string
  entry?: 'from_feed_author' | 'direct'
  limit?: number
  /** Reuse an existing tab (from previous search/detail). */
  tabId?: string
}

export interface UserProfileResult {
  ok: boolean
  user_id: string
  username: string
  basicInfo?: {
    nickname?: string
    description?: string
    followers?: string
    following?: string
    likes?: string
  }
  feeds: Array<{
    id: string
    title: string
    url: string
    rank: number
  }>
  navigation_mode: 'human_path' | 'direct_url'
  finalUrl: string
  tabId: string
  actions: string[]
  login_required?: boolean
  error?: string
}

export async function userProfile(
  client: CamofoxClient,
  input: UserProfileInput,
): Promise<UserProfileResult> {
  const actions: string[] = []
  const userId = config.camofoxUserId
  const sessionKey = config.camofoxSessionKey
  const limit = Math.min(input.limit ?? 6, 20)
  let tabId = input.tabId ?? ''
  let finalUrl = ''

  try {
    // Create tab or reuse existing
    if (!tabId) {
      const tab = await client.createTab({ userId, sessionKey, trace: config.camofoxTrace })
      tabId = tab.tabId
      actions.push('create_tab')
    }

    const ctx: XhsNavigationContext = { tabId, userId, url: '' }

    // Navigate to profile
    if (input.entry === 'direct' && input.user_id) {
      const profileUrl = `https://www.xiaohongshu.com/user/profile/${input.user_id}`
      await client.navigate(tabId, { userId, url: profileUrl })
      actions.push('navigate_direct_profile')
      finalUrl = profileUrl
    } else {
      // From feed author: assume we're already on a detail page
      // Try to click author link first
      const snapshot = await client.snapshot(tabId, { userId })
      const { isLoginPage, isVerificationPage } = detectLoginOrVerificationPage(snapshot)
      if (isLoginPage || isVerificationPage) {
        actions.push('login_required')
        return {
          ok: false,
          user_id: input.user_id ?? '',
          username: '',
          feeds: [],
          navigation_mode: 'human_path',
          finalUrl: snapshot.url ?? '',
          tabId,
          actions,
          login_required: true,
          error: isVerificationPage ? 'verification_required' : 'login_required',
        }
      }

      const authorLink = findAuthorLink(snapshot)
      if (authorLink) {
        await humanClick(client, tabId, userId, authorLink.ref)
        actions.push('click_author_from_detail')
        await waitAfterClick()
        await waitForXhsStable(client, tabId, userId)
      } else if (input.user_id) {
        // Fallback to direct navigation
        const profileUrl = `https://www.xiaohongshu.com/user/profile/${input.user_id}`
        await client.navigate(tabId, { userId, url: profileUrl })
        actions.push('fallback_direct_profile')
      } else {
        return {
          ok: false,
          user_id: '',
          username: '',
          feeds: [],
          navigation_mode: 'human_path',
          finalUrl: snapshot.url ?? '',
          tabId,
          actions,
          error: 'no_user_id_and_no_author_link_found',
        }
      }
    }

    await waitForXhsStable(client, tabId, userId)
    const profileSnapshot = await client.snapshot(tabId, { userId })
    finalUrl = profileSnapshot.url ?? finalUrl
    actions.push('wait_profile_load')

    // Extract basic info from accessibility tree
    const username = extractUsernameFromSnapshot(profileSnapshot)
    const basicInfo = extractBasicInfoFromSnapshot(profileSnapshot)

    // Scroll to load more feeds (1-2 natural scrolls)
    for (let i = 0; i < 2; i++) {
      await humanScroll(client, ctx, 'down')
      actions.push(`scroll_feeds_${i + 1}`)
      await waitForXhsStable(client, tabId, userId)
    }

    // Extract feeds from updated snapshot
    const feeds: UserProfileResult['feeds'] = []
    const elements = profileSnapshot.elements ?? []

    // Find post cards
    const postCards = elements.filter(
      (el) =>
        el.role === 'link' &&
        el.name &&
        el.name.length > 3 &&
        el.name.length < 150 &&
        !el.name?.includes('搜索') &&
        !el.name?.includes('发现'),
    )

    for (let i = 0; i < Math.min(limit, postCards.length); i++) {
      const el = postCards[i]
      feeds.push({
        id: el.ref ?? `post-${i}`,
        title: el.name ?? '',
        url: extractHref(el),
        rank: i + 1,
      })
    }

    auditLog.append({
      tool: 'user_profile',
      profile: userId,
      actions,
      navigationMode: input.entry === 'direct' ? 'direct_url' : 'human_path',
      resultCount: feeds.length,
      finalUrl: finalUrl,
      tabId,
      status: 'ok',
      extra: { user_id: input.user_id, username, entry: input.entry },
    })

    return {
      ok: true,
      user_id: input.user_id ?? '',
      username,
      basicInfo,
      feeds,
      navigation_mode: input.entry === 'direct' ? 'direct_url' : 'human_path',
      finalUrl: finalUrl,
      tabId,
      actions,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    actions.push('error')

    auditLog.append({
      tool: 'user_profile',
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
      user_id: input.user_id ?? '',
      username: '',
      feeds: [],
      navigation_mode: 'human_path',
      finalUrl: finalUrl,
      tabId,
      actions,
      error,
    }
  }
}

function extractUsernameFromSnapshot(snapshot: { accessibilityTree?: string; elements?: unknown[] }): string {
  const tree = snapshot.accessibilityTree ?? ''
  // Look for username pattern in tree
  const match = tree.match(/(?:昵称|用户名|name)[:：]\s*([^\n\r]{1,50})/)
  if (match) return match[1]
  // Fallback: first link name that looks like a username
  const elements = snapshot.elements as Array<{ role?: string; name?: string }> | undefined
  const username = elements?.find((el) => el.role === 'link' && el.name && el.name.length > 0 && el.name.length < 30)?.name ?? ''
  return username
}

function extractBasicInfoFromSnapshot(snapshot: { accessibilityTree?: string }): UserProfileResult['basicInfo'] {
  const tree = snapshot.accessibilityTree ?? ''
  // Try to extract follower/following/like counts
  const followerMatch = tree.match(/(?:粉丝|followers?)[:：]\s*([^\n\r,]{1,20})/)
  const followingMatch = tree.match(/(?:关注|following)[:：]\s*([^\n\r,]{1,20})/)
  return {
    followers: followerMatch?.[1],
    following: followingMatch?.[1],
  }
}

function extractHref(el: { properties?: Record<string, unknown> }): string {
  const props = el.properties as Record<string, unknown> | undefined
  return (typeof props?.href === 'string' ? props.href : '') as string
}