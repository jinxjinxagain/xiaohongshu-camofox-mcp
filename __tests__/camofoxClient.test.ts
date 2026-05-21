/**
 * Unit tests for CamofoxClient HTTP request/response parsing and error handling.
 */

import { CamofoxClient } from '../src/camofox/client.js'

describe('CamofoxClient', () => {
  describe('createTab', () => {
    it('throws on missing tabId', async () => {
      const client = new CamofoxClient('http://localhost:9377')
      // @ts-expect-error – inject mock request
      client.request = async () => ({ url: 'https://example.com' })

      await expect(client.createTab({ userId: 'u1', sessionKey: 's1' })).rejects.toThrow('no tabId')
    })
  })

  describe('listTabs', () => {
    it('returns empty array when request returns non-array', async () => {
      const client = new CamofoxClient('http://localhost:9377')
      // @ts-expect-error – inject mock request
      client.request = async () => []

      const tabs = await client.listTabs('u1')
      expect(tabs).toEqual([])
    })
  })

  describe('request timeout', () => {
    it('throws on HTTP error status', async () => {
      const client = new CamofoxClient('http://localhost:99999')
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () =>
        ({
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway',
        }) as unknown as Response

      await expect(
        client.createTab({ userId: 'u1', sessionKey: 's1' }),
      ).rejects.toThrow('HTTP 502')

      globalThis.fetch = originalFetch
    })
  })

  describe('error response', () => {
    it('throws on HTTP error', async () => {
      const client = new CamofoxClient('http://localhost:99999')
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () =>
        ({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        }) as unknown as Response

      await expect(
        client.createTab({ userId: 'u1', sessionKey: 's1' }),
      ).rejects.toThrow('HTTP 500')

      globalThis.fetch = originalFetch
    })
  })
})
