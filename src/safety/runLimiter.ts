/**
 * Rate limiter and action budget tracker for XHS MCP tools.
 *
 * Enforces:
 * - Global minimum interval between tool calls (default 90-180s)
 * - Per-hour search cap (default 10)
 * - Per-search limits (keyword count, candidate count)
 * - Per-detail limits (comment count)
 */

import { config } from '../config.js'

export interface RunLimiterConfig {
  minIntervalMs: number
  maxIntervalMs: number
  maxSearchesPerHour: number
  maxKeywordPerSearch: number
  maxCandidatesPerSearch: number
  maxPostsPerProfile: number
  maxCommentsPerDetail: number
}

export class RunLimiter {
  private lastToolCallMs: number = 0
  private lastSearchHour: number = 0
  private searchCountThisHour: number = 0

  constructor(private readonly cfg: Partial<RunLimiterConfig> = {}) {}

  private get cfgFull(): RunLimiterConfig {
    return {
      minIntervalMs: this.cfg.minIntervalMs ?? config.minToolIntervalMs,
      maxIntervalMs: this.cfg.maxIntervalMs ?? config.maxToolIntervalMs,
      maxSearchesPerHour: this.cfg.maxSearchesPerHour ?? 10,
      maxKeywordPerSearch: this.cfg.maxKeywordPerSearch ?? 1,
      maxCandidatesPerSearch: this.cfg.maxCandidatesPerSearch ?? 5,
      maxPostsPerProfile: this.cfg.maxPostsPerProfile ?? 6,
      maxCommentsPerDetail: this.cfg.maxCommentsPerDetail ?? 20,
    }
  }

  /**
   * Check and consume the global tool call interval.
   * Throws if cooldown has not elapsed.
   */
  checkCooldown(): void {
    const { minIntervalMs } = this.cfgFull
    const now = Date.now()
    const elapsed = now - this.lastToolCallMs
    if (elapsed < minIntervalMs) {
      const remaining = minIntervalMs - elapsed
      throw new Error(
        `RATE_LIMITED: tool cooldown not elapsed. Wait ${Math.ceil(remaining / 1000)}s. (min=${minIntervalMs}ms)`,
      )
    }
    this.lastToolCallMs = now
  }

  /**
   * Check search budget for this hour. Increments on success.
   * Throws if hourly budget exhausted.
   */
  checkSearchBudget(): void {
    const { maxSearchesPerHour } = this.cfgFull
    const now = Date.now()
    const currentHour = Math.floor(now / 3_600_000)
    if (currentHour !== this.lastSearchHour) {
      this.lastSearchHour = currentHour
      this.searchCountThisHour = 0
    }
    if (this.searchCountThisHour >= maxSearchesPerHour) {
      throw new Error(
        `RATE_LIMITED: hourly search budget exhausted (${maxSearchesPerHour}/hour). Wait for next hour.`,
      )
    }
    this.searchCountThisHour++
  }

  /** Milliseconds until cooldown expires (0 if ready). */
  cooldownRemainingMs(): number {
    const { minIntervalMs } = this.cfgFull
    const elapsed = Date.now() - this.lastToolCallMs
    return Math.max(0, minIntervalMs - elapsed)
  }

  searchCountForCurrentHour(): number {
    return this.searchCountThisHour
  }

  resetSearchCount(): void {
    this.searchCountThisHour = 0
  }
}

export const globalRunLimiter = new RunLimiter()
