/**
 * search_feeds MCP tool — human-like XHS search.
 *
 * Flow: open XHS home → click search box → humanType keyword → wait results
 * → natural scroll → extract candidates.
 * Never navigates directly to a search URL.
 */

import { config } from '../config.js'
import { globalRunLimiter } from '../safety/runLimiter.js'
import { auditLog } from '../audit/log.js'
import { humanType } from '../human/keyboard.js'
import { humanClick } from '../human/mouse.js'
import { sleep, waitAfterNavigation, thinkPause } from '../human/timing.js'
import { CamofoxClient } from '../camofox/client.js'
import {
  waitForXhsStable,
  findAndClickSearchBox,
  findFeedCard,
  extractFeedsFromSnapshot,
  detectLoginOrVerificationPage,
  humanScroll,
  type XhsNavigationContext,
} from './navigation.js'

export interface SearchFeedsInput {
  keyword: string
  limit?: number
  mode?: 'human_path' | 'direct_url'
  filters?: {
    sort_by?: string
    note_type?: string
  }
}

export interface SearchFeedsResult {
  ok: boolean
  keyword: string
  candidates: Array<{
    id: string
    title: string
    url: string
    rank: number
    user?: { id?: string; name?: string }
  }>
  navigation_mode: 'human_path' | 'direct_url'
  finalUrl: string
  tabId: string
  actions: string[]
  login_required?: boolean
  rate_limited?: boolean
  error?: string
}

export async function searchFeeds(
  client: CamofoxClient,
  input: SearchFeedsInput,
): Promise<SearchFeedsResult> {
  const actions: string[] = []
  const keyword = input.keyword.trim()
  const limit = Math.min(input.limit ?? 5, 10)
  const userId = config.camofoxUserId
  const sessionKey = config.camofoxSessionKey

  // Enforce cooldown
  try {
    globalRunLimiter.checkCooldown()
  } catch (err) {
    return {
      ok: false,
      keyword,
      candidates: [],
      navigation_mode: 'human_path',
      finalUrl: '',
      tabId: '',
      actions,
      rate_limited: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // Check search budget
  try {
    globalRunLimiter.checkSearchBudget()
  } catch (err) {
    return {
      ok: false,
      keyword,
      candidates: [],
      navigation_mode: 'human_path',
      finalUrl: '',
      tabId: '',
      actions,
      rate_limited: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  let tabId = ''
  let finalUrl = ''

  try {
    // Step 1: Open XHS home page
    const tab = await client.createTab({
      userId,
      sessionKey,
      url: 'https://www.xiaohongshu.com/explore',
      trace: config.camofoxTrace,
    })
    tabId = tab.tabId
    actions.push('open_xhs_home')

    await waitForXhsStable(client, tabId, userId)
    finalUrl = `https://www.xiaohongshu.com/explore`

    // Step 2: Take snapshot to check login status
    const homeSnapshot = await client.snapshot(tabId, { userId })
    const { isLoginPage, isVerificationPage } = detectLoginOrVerificationPage(homeSnapshot)
    if (isLoginPage || isVerificationPage) {
      actions.push('login_required')
      return {
        ok: false,
        keyword,
        candidates: [],
        navigation_mode: 'human_path',
        finalUrl: finalUrl,
        tabId,
        actions,
        login_required: true,
        error: isVerificationPage ? 'verification_required' : 'login_required',
      }
    }

    actions.push('check_login_status')

    // Step 3: Find and click search box
    const searchBox = await findAndClickSearchBox(client, { tabId, userId, url: finalUrl })
    if (!searchBox) {
      // Try direct navigation as fallback (mark as direct_url)
      await client.navigate(tabId, { userId, url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}` })
      actions.push('fallback_direct_search_url')
      await waitForXhsStable(client, tabId, userId)
    } else {
      actions.push('click_search_box')
      await waitAfterNavigation()

      // Step 4: Type keyword using human keyboard
      const searchInputRef = searchBox.ref
      await humanType(client, tabId, userId, keyword, searchInputRef, { submit: true })
      actions.push('human_type_keyword')

      await thinkPause()

      // Wait for search results to load — XHS redirects to /search_result URL
      // Poll URL until it contains 'search_result' (max 20s)
      for (let wait = 0; wait < 20; wait++) {
        const currentUrl = (await client.snapshot(tabId, { userId })).url ?? ''
        if (currentUrl.includes('/search_result')) {
          finalUrl = currentUrl
          actions.push('wait_search_results')
          break
        }
        await sleep(1000)
        if (wait === 19) actions.push('wait_search_results_timeout')
      }
    }

    // Step 5: Natural scroll (1-2 times)
    const scrollCount = input.filters?.note_type === 'video' ? 1 : 2
    for (let i = 0; i < scrollCount; i++) {
      await humanScroll(client, { tabId, userId, url: finalUrl }, 'down')
      actions.push(`scroll_${i + 1}`)
      await waitForXhsStable(client, tabId, userId)
    }

    // Step 6: Extract candidates from snapshot
    const resultsSnapshot = await client.snapshot(tabId, { userId })
    const candidates = extractFeedsFromSnapshot(resultsSnapshot, limit)

    finalUrl = resultsSnapshot.url ?? finalUrl
    actions.push('extract_candidates')

    // Keep tab open for follow-up (profile/detail tools will reuse)
    // Close tab only on error

    const result: SearchFeedsResult = {
      ok: true,
      keyword,
      candidates,
      navigation_mode: 'human_path',
      finalUrl: finalUrl,
      tabId,
      actions,
    }

    // Audit log
    auditLog.append({
      tool: 'search_feeds',
      profile: userId,
      actions,
      navigationMode: 'human_path',
      resultCount: candidates.length,
      finalUrl,
      tabId,
      status: 'ok',
      extra: { keyword, limit },
    })

    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    actions.push('error')

    // Attempt to close tab on error
    if (tabId) {
      try { await client.closeTab(tabId) } catch { /* ignore */ }
    }

    auditLog.append({
      tool: 'search_feeds',
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
      keyword,
      candidates: [],
      navigation_mode: 'human_path',
      finalUrl: finalUrl,
      tabId,
      actions,
      error,
    }
  }
}