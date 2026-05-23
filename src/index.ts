/**
 * Xiaohongshu Camofox MCP Server
 *
 * Phase 1: Project skeleton — MCP bootstrap, CamofoxClient smoke test.
 * Phase 3: search_feeds (human path search)
 * Phase 4: user_profile, get_feed_detail (navigation + extraction)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { config } from './config.js'
import { CamofoxClient } from './camofox/client.js'
import { searchFeeds, type SearchFeedsInput } from './xhs/searchFeeds.js'
import { userProfile, type UserProfileInput } from './xhs/userProfile.js'
import { getFeedDetail, classifyChangeLinePost, type GetFeedDetailInput } from './xhs/feedDetail.js'

// ── Server bootstrap ───────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'xiaohongshu-camofox-mcp',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
)

const camofox = new CamofoxClient(config.camofoxBaseUrl)

// ── Tool registry ─────────────────────────────────────────────────────────────

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
}

const tools: ToolDef[] = []

function registerTool(tool: ToolDef): void {
  tools.push(tool)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  try {
    const result = await tool.handler(args as Record<string, unknown>)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }))
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }))

// ── Tools ─────────────────────────────────────────────────────────────────────

// smoke_test — verify Camofox connectivity
registerTool({
  name: 'smoke_test',
  description: 'Smoke test: verify Camofox connectivity and list open tabs. No XHS interaction.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    try {
      const tabs = await camofox.listTabs(config.camofoxUserId)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                camofoxBaseUrl: config.camofoxBaseUrl,
                userId: config.camofoxUserId,
                sessionKey: config.camofoxSessionKey,
                openTabs: tabs.length,
                tabs: tabs.map((t) => ({ tabId: t.tabId, url: t.url, title: t.title })),
              },
              null,
              2,
            ),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2) }],
        isError: true,
      }
    }
  },
})

// search_feeds — human-like XHS search
registerTool({
  name: 'search_feeds',
  description:
    'Search XHS for feeds by keyword using a human-like browsing path (open home → click search → type keyword → natural scroll → extract candidates). ' +
    'Never navigates directly to a search URL. Returns up to `limit` feed candidates with id, title, url, rank, and user info. ' +
    'Enforces rate limiting (90-180s cooldown, 10 searches/hour). ' +
    'If login_required or verification_required, stop and report.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Search keyword (e.g. "香蕉攀岩上海")' },
      limit: { type: 'number', description: 'Max candidates to return (default 5, max 10)' },
      mode: { type: 'string', enum: ['human_path', 'direct_url'], description: 'Navigation mode (default human_path)' },
      filters: {
        type: 'object',
        properties: {
          sort_by: { type: 'string', description: 'Sort order (e.g. "综合", "最新")' },
          note_type: { type: 'string', description: 'Note type filter (e.g. "video", "图文")' },
        },
      },
    },
    required: ['keyword'],
  },
  handler: async (args) => {
    if (config.dryRun) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, dry_run: true, keyword: args.keyword, message: 'Dry run: would search for keyword' }, null, 2) }],
      }
    }
    const input = args as unknown as SearchFeedsInput
    const result = await searchFeeds(camofox, input)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    }
  },
})

// user_profile — navigate to XHS user profile
registerTool({
  name: 'user_profile',
  description:
    'Navigate to an XHS user profile page and extract user basic info and recent feeds. ' +
    'Entry can be "from_feed_author" (click author from detail page) or "direct" (direct URL). ' +
    'Returns username, basicInfo (followers/following/likes), and up to `limit` recent feeds with id, title, url.',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'XHS user ID (numeric or string ID)' },
      xsec_token: { type: 'string', description: 'XHS security token (optional)' },
      entry: { type: 'string', enum: ['from_feed_author', 'direct'], description: 'How to reach the profile (default from_feed_author)' },
      limit: { type: 'number', description: 'Max feeds to return (default 6, max 20)' },
      tabId: { type: 'string', description: 'Reuse an existing Camofox tab (from previous search/detail call)' },
    },
  },
  handler: async (args) => {
    if (config.dryRun) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, dry_run: true, user_id: args.user_id, message: 'Dry run: would navigate to profile' }, null, 2) }],
      }
    }
    const input = args as unknown as UserProfileInput
    const result = await userProfile(camofox, input)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    }
  },
})

// get_feed_detail — navigate to XHS feed detail and extract content
registerTool({
  name: 'get_feed_detail',
  description:
    'Navigate to an XHS feed detail page and extract title, body, author, interactions (likes/collects/comments), and optionally comments. ' +
    'Entry can be "search_result", "profile", or "direct_url". ' +
    'Use tabId to reuse an existing tab from previous search/profile call. ' +
    'Returns feed_id, title, body, author, interactions, comments_loaded, final_url.',
  inputSchema: {
    type: 'object',
    properties: {
      feed_id: { type: 'string', description: 'XHS feed/note ID' },
      xsec_token: { type: 'string', description: 'XHS security token (optional)' },
      from_search_keyword: { type: 'string', description: 'Keyword that led to this feed (for audit)' },
      load_comments: { type: 'boolean', description: 'Whether to load comments (default false)' },
      max_comments: { type: 'number', description: 'Max comments to load (default 20)' },
      entry: { type: 'string', enum: ['search_result', 'profile', 'direct_url'], description: 'Entry point (default search_result)' },
      tabId: { type: 'string', description: 'Reuse an existing Camofox tab' },
    },
    required: ['feed_id'],
  },
  handler: async (args) => {
    if (config.dryRun) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, dry_run: true, feed_id: args.feed_id, message: 'Dry run: would navigate to feed detail' }, null, 2) }],
      }
    }
    const input = args as unknown as GetFeedDetailInput
    const result = await getFeedDetail(camofox, input)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    }
  },
})

// classify_change_line — simple rule-based classifier for XHS climbing posts
registerTool({
  name: 'classify_change_line',
  description:
    'Classify an XHS feed as "换线" (route change/new route) or not based on title and body text. ' +
    'Positive keywords: 换线/新线/首攀/新开/红点/定级. ' +
    'Negative patterns: 磕了很久/终于完成/个人完攀. ' +
    'Returns is_change_line, keywords_matched, and reason.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Feed title' },
      body: { type: 'string', description: 'Feed body text' },
    },
    required: ['title', 'body'],
  },
  handler: async (args) => {
    const { title = '', body = '' } = args as { title?: string; body?: string }
    const result = classifyChangeLinePost(title, body)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  },
})

// ── Boot ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error('[xhs-camofox-mcp] Starting on port', config.port)
  console.error('[xhs-camofox-mcp] Camofox base URL:', config.camofoxBaseUrl)
  console.error('[xhs-camofox-mcp] Camofox userId:', config.camofoxUserId)
  console.error('[xhs-camofox-mcp] Session key:', config.camofoxSessionKey)
  console.error('[xhs-camofox-mcp] Dry run:', config.dryRun)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[xhs-camofox-mcp] Connected. MCP tools:', tools.map((t) => t.name).join(', '))
}

main().catch((err) => {
  console.error('[xhs-camofox-mcp] Fatal:', err)
  process.exit(1)
})