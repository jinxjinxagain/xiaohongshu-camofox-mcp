/**
 * Per-tool run audit log (JSONL).
 *
 * Each tool invocation appends one JSON line to the audit log file.
 * Format:
 * {
 *   "ts": "ISO timestamp",
 *   "tool": "tool name",
 *   "profile": "camofox userId",
 *   "actions": ["open_home", "click_search", ...],
 *   "navigation_mode": "human_path | direct_url",
 *   "result_count": number,
 *   "final_url": "...",
 *   "tabId": "...",
 *   "status": "ok | error | rate_limited",
 *   "error"?: "...",
 *   "dry_run": boolean
 * }
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config.js'

export type AuditStatus = 'ok' | 'error' | 'rate_limited'

export interface AuditEntry {
  tool: string
  profile: string
  actions: string[]
  navigationMode: 'human_path' | 'direct_url'
  resultCount: number
  finalUrl: string
  tabId: string
  status: AuditStatus
  error?: string
  dryRun?: boolean
  extra?: Record<string, unknown>
}

export class AuditLog {
  constructor(private readonly path: string = config.auditLogPath) {
    // Ensure directory exists
    try {
      mkdirSync(dirname(this.path), { recursive: true })
    } catch {
      // ignore
    }
  }

  append(entry: AuditEntry): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tool: entry.tool,
      profile: entry.profile,
      actions: entry.actions,
      navigation_mode: entry.navigationMode,
      result_count: entry.resultCount,
      final_url: entry.finalUrl,
      tabId: entry.tabId,
      status: entry.status,
      error: entry.error,
      dry_run: entry.dryRun,
      ...entry.extra,
    })
    try {
      appendFileSync(this.path, line + '\n', 'utf8')
    } catch (err) {
      console.error('[AuditLog] failed to write:', err)
    }
  }
}

export const auditLog = new AuditLog()
