/**
 * Camofox Browser Gateway HTTP API client.
 *
 * Wraps the Camofox HTTP API with:
 * - Typed request/response
 * - Consistent timeout handling
 * - Unified error parsing
 * - Tab lifecycle tracking
 */

import type {
  CamofoxEnvelope,
  ClickRequest,
  ClickResponse,
  CreateTabRequest,
  CreateTabResponse,
  NavigateRequest,
  NavigateResponse,
  ScrollRequest,
  ScrollResponse,
  SnapshotData,
  SnapshotRequest,
  TabInfo,
  TypeRequest,
  TypeResponse,
} from './types.js'

export class CamofoxClient {
  private readonly baseUrl: string
  private readonly defaultTimeout: number

  constructor(baseUrl: string, timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultTimeout = timeoutMs
  }

  // ── Tab lifecycle ────────────────────────────────────────────────────────────

  /**
   * Create a new browser tab.
   */
  async createTab(req: CreateTabRequest): Promise<CreateTabResponse> {
    const body = await this.request<CamofoxEnvelope<{ tabId: string; url: string }>>('/tabs', {
      method: 'POST',
      body: req,
    })
    if (!body.tabId) throw new Error(`Camofox createTab failed: ${body.error ?? 'no tabId'}`)
    return { tabId: body.tabId, url: body.url ?? '' }
  }

  /**
   * List open tabs for a user session.
   */
  async listTabs(userId: string): Promise<TabInfo[]> {
    const body = await this.request<CamofoxEnvelope<TabInfo[]>>(`/tabs?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
    })
    return Array.isArray(body as unknown) ? (body as unknown as TabInfo[]) : []
  }

  /**
   * Close a specific tab.
   */
  async closeTab(tabId: string): Promise<void> {
    await this.request(`/tabs/${encodeURIComponent(tabId)}`, { method: 'DELETE' })
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  /**
   * Navigate a tab to a URL or search macro.
   */
  async navigate(tabId: string, req: NavigateRequest): Promise<NavigateResponse> {
    const body = await this.request<CamofoxEnvelope<{ url: string; tabId: string; snapshot?: SnapshotData }>>(
      `/tabs/${encodeURIComponent(tabId)}/navigate`,
      { method: 'POST', body: req },
    )
    if (!body.url) throw new Error(`Camofox navigate failed: ${body.error ?? 'no url'}`)
    return {
      url: body.url,
      tabId: body.tabId ?? tabId,
      snapshot: (body as unknown as { snapshot?: SnapshotData }).snapshot,
    }
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  /**
   * Click an element by ref or CSS selector.
   */
  async click(tabId: string, req: ClickRequest): Promise<ClickResponse> {
    const body = await this.request<CamofoxEnvelope<{ tabId: string; url: string; clicked?: boolean }>>(
      `/tabs/${encodeURIComponent(tabId)}/click`,
      { method: 'POST', body: req },
    )
    return {
      tabId: body.tabId ?? tabId,
      url: body.url ?? '',
      clicked: (body as unknown as { clicked?: boolean }).clicked,
      error: body.error,
    }
  }

  /**
   * Type text into a focused element or one identified by ref/selector.
   */
  async type(tabId: string, req: TypeRequest): Promise<TypeResponse> {
    const body = await this.request<CamofoxEnvelope<{ tabId: string; typed: boolean; submitted?: boolean }>>(
      `/tabs/${encodeURIComponent(tabId)}/type`,
      { method: 'POST', body: req },
    )
    return {
      tabId: body.tabId ?? tabId,
      typed: (body as unknown as { typed?: boolean }).typed ?? true,
      submitted: (body as unknown as { submitted?: boolean }).submitted,
      error: body.error,
    }
  }

  /**
   * Scroll the page or to a specific element.
   */
  async scroll(tabId: string, req: ScrollRequest): Promise<ScrollResponse> {
    const body = await this.request<CamofoxEnvelope<{ tabId: string; scrolled: boolean }>>(
      `/tabs/${encodeURIComponent(tabId)}/scroll`,
      { method: 'POST', body: req },
    )
    return {
      tabId: body.tabId ?? tabId,
      scrolled: (body as unknown as { scrolled?: boolean }).scrolled ?? true,
      error: body.error,
    }
  }

  /**
   * Evaluate JavaScript in the tab context.
   */
  async evaluate(tabId: string, expression: string, userId: string): Promise<unknown> {
    const body = await this.request<CamofoxEnvelope<{ result: unknown }>>(
      `/tabs/${encodeURIComponent(tabId)}/evaluate?userId=${encodeURIComponent(userId)}`,
      { method: 'POST', body: { expression } },
    )
    return (body as unknown as { result?: unknown }).result
  }

  // ── Content ─────────────────────────────────────────────────────────────────

  /**
   * Take an accessibility snapshot of the current tab state.
   */
  async snapshot(tabId: string, req: SnapshotRequest = {}): Promise<SnapshotData> {
    const params = new URLSearchParams()
    if (req.userId) params.set('userId', req.userId)
    if (req.format) params.set('format', req.format)
    if (req.offset !== undefined) params.set('offset', String(req.offset))
    if (req.includeScreenshot) params.set('includeScreenshot', 'true')
    const qs = params.toString()
    const path = `/tabs/${encodeURIComponent(tabId)}/snapshot${qs ? `?${qs}` : ''}`
    const body = await this.request<CamofoxEnvelope<SnapshotData>>(path, { method: 'GET' })
    const raw = (body as unknown as SnapshotData) ?? { url: '' }
    // Camofox returns raw text as `snapshot` field; map it to `accessibilityTree`
    // so downstream code that reads `accessibilityTree` gets the data.
    if (raw.snapshot && !raw.accessibilityTree) {
      return { ...raw, accessibilityTree: raw.snapshot }
    }
    return raw
  }

  // ── HTTP layer ──────────────────────────────────────────────────────────────

  private async request<T>(path: string, opts: { method: string; body?: unknown; timeoutMs?: number }): Promise<T> {
    const { method, body, timeoutMs = this.defaultTimeout } = opts
    const url = `${this.baseUrl}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Camofox HTTP ${res.status}: ${text}`)
      }
      const json = await res.json() as T
      return json
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Camofox request timed out after ${timeoutMs}ms: ${path}`)
      }
      throw err
    }
  }
}
