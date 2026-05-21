/**
 * Camofox Browser Gateway HTTP API types.
 * Based on camofox-browser openapi.json v1.10.1
 */

export interface CreateTabRequest {
  userId: string
  sessionKey: string
  listItemId?: string
  url?: string
  trace?: boolean
}

export interface CreateTabResponse {
  tabId: string
  url: string
}

export interface NavigateRequest {
  userId: string
  url?: string
  macro?: string
  query?: string
  sessionKey?: string
  listItemId?: string
}

export interface NavigateResponse {
  url: string
  tabId: string
  snapshot?: SnapshotData
}

export interface ClickRequest {
  userId: string
  ref?: string
  selector?: string
  doubleClick?: boolean
  coordinates?: { x: number; y: number }
}

export interface ClickResponse {
  tabId: string
  url: string
  clicked?: boolean
  error?: string
  snapshot?: SnapshotData
}

export interface TypeRequest {
  userId: string
  ref?: string
  selector?: string
  text: string
  clear?: boolean
  submit?: boolean
}

export interface TypeResponse {
  tabId: string
  typed: boolean
  submitted?: boolean
  error?: string
}

export interface ScrollRequest {
  userId: string
  direction?: 'up' | 'down' | 'top' | 'bottom'
  amount?: number
  selector?: string
}

export interface ScrollResponse {
  tabId: string
  scrolled: boolean
  error?: string
  snapshot?: SnapshotData
}

export interface SnapshotRequest {
  userId?: string
  format?: 'text' | 'html' | 'accessibility'
  offset?: number
  includeScreenshot?: boolean
}

export interface SnapshotData {
  url: string
  title?: string
  elements?: SnapshotElement[]
  accessibilityTree?: string
  screenshot?: string
}

export interface SnapshotElement {
  ref: string
  role?: string
  name?: string
  value?: string
  description?: string
  focused?: boolean
  pressed?: boolean
  checked?: boolean
  expanded?: boolean
  level?: number
  children?: string[]
  boundingRect?: { x: number; y: number; width: number; height: number }
  properties?: Record<string, unknown>
}

export interface CamofoxEnvelope<T = unknown> {
  ok?: boolean
  tabId?: string
  url?: string
  data?: T
  error?: string
  message?: string
}

export interface ListTabsRequest {
  userId: string
}

export interface TabInfo {
  tabId: string
  url: string
  title?: string
  active?: boolean
}
