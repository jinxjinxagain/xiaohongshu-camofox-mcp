/**
 * Environment configuration with defaults.
 * All values can be overridden via environment variables.
 */

export const config = {
  // Camofox Browser Gateway
  camofoxBaseUrl: process.env.CAMOFOX_BASE_URL ?? 'http://127.0.0.1:9377',
  camofoxUserId: process.env.CAMOFOX_USER_ID ?? 'xhs-climber-primary',
  camofoxSessionKey: process.env.CAMOFOX_SESSION_KEY ?? 'xhs-camofox-mcp',
  camofoxTrace: process.env.CAMOFOX_TRACE === 'true',

  // MCP server
  port: Number(process.env.PORT ?? '18061'),

  // Safety limits
  minToolIntervalMs: Number(process.env.XHS_MIN_TOOL_INTERVAL_MS ?? '90000'),
  maxToolIntervalMs: Number(process.env.XHS_MAX_TOOL_INTERVAL_MS ?? '180000'),
  maxActionsPerRun: Number(process.env.XHS_MAX_ACTIONS_PER_RUN ?? '1'),

  // Behavior flags
  dryRun: process.env.XHS_MCP_DRY_RUN === 'true',

  // Audit
  auditLogPath: process.env.XHS_AUDIT_LOG_PATH ?? './data/audit/xhs-camofox-mcp.jsonl',
} as const

export type Config = typeof config
