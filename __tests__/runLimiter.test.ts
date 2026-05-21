/**
 * Unit tests for RunLimiter.
 */

import { RunLimiter } from '../src/safety/runLimiter.js'

describe('RunLimiter', () => {
  describe('checkCooldown', () => {
    it('passes on first call', () => {
      const limiter = new RunLimiter({ minIntervalMs: 1000 })
      expect(() => limiter.checkCooldown()).not.toThrow()
    })

    it('throws when called too quickly', () => {
      const limiter = new RunLimiter({ minIntervalMs: 10_000 })
      limiter.checkCooldown()
      expect(() => limiter.checkCooldown()).toThrow(/RATE_LIMITED/)
    })

    it('passes after cooldown', async () => {
      const limiter = new RunLimiter({ minIntervalMs: 5 })
      limiter.checkCooldown()
      await new Promise((r) => setTimeout(r, 10))
      expect(() => limiter.checkCooldown()).not.toThrow()
    })

    it('reports remaining cooldown', () => {
      const limiter = new RunLimiter({ minIntervalMs: 1000 })
      limiter.checkCooldown()
      const remaining = limiter.cooldownRemainingMs()
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(1000)
    })
  })

  describe('checkSearchBudget', () => {
    it('allows up to maxSearchesPerHour', () => {
      const limiter = new RunLimiter({ maxSearchesPerHour: 3 })
      for (let i = 0; i < 3; i++) {
        expect(() => limiter.checkSearchBudget()).not.toThrow()
      }
    })

    it('throws when hourly budget exhausted', () => {
      const limiter = new RunLimiter({ maxSearchesPerHour: 2 })
      limiter.checkSearchBudget()
      limiter.checkSearchBudget()
      expect(() => limiter.checkSearchBudget()).toThrow(/hourly search budget exhausted/)
    })

    it('resets after resetSearchCount', () => {
      const limiter = new RunLimiter({ maxSearchesPerHour: 2 })
      limiter.checkSearchBudget()
      limiter.checkSearchBudget()
      limiter.resetSearchCount()
      expect(() => limiter.checkSearchBudget()).not.toThrow()
    })
  })
})
