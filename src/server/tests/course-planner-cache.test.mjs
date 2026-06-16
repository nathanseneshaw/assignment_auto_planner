import assert from 'node:assert'
import { describe, it } from 'node:test'
import { cacheGet, cacheSet, cacheMemo, cacheFlush } from '../course-planner/cache.js'

describe('cacheGet / cacheSet', () => {
  it('returns null for a key that was never set', () => {
    cacheFlush()
    assert.equal(cacheGet('missing'), null)
  })

  it('returns the stored value immediately after set', () => {
    cacheFlush()
    cacheSet('k', 'hello', 5000)
    assert.equal(cacheGet('k'), 'hello')
  })

  it('stores objects', () => {
    cacheFlush()
    const obj = { a: 1, b: [2, 3] }
    cacheSet('obj', obj, 5000)
    assert.deepEqual(cacheGet('obj'), obj)
  })

  it('returns null when TTL is already expired (negative TTL)', () => {
    cacheFlush()
    // expiresAt = Date.now() - 1, so it is already past expiry
    cacheSet('expired', 'gone', -1)
    assert.equal(cacheGet('expired'), null)
  })

  it('evicts the key after a negative-TTL entry expires', () => {
    cacheFlush()
    cacheSet('evict', 'x', -1)
    cacheGet('evict') // this triggers eviction
    // A second get should still be null
    assert.equal(cacheGet('evict'), null)
  })

  it('different keys are independent', () => {
    cacheFlush()
    cacheSet('a', 1, 5000)
    cacheSet('b', 2, 5000)
    assert.equal(cacheGet('a'), 1)
    assert.equal(cacheGet('b'), 2)
  })
})

describe('cacheFlush', () => {
  it('clears a single key when given one', () => {
    cacheFlush()
    cacheSet('x', 'value', 5000)
    cacheSet('y', 'other', 5000)
    cacheFlush('x')
    assert.equal(cacheGet('x'), null)
    assert.equal(cacheGet('y'), 'other')
  })

  it('clears everything when called with no argument', () => {
    cacheFlush()
    cacheSet('a', 1, 5000)
    cacheSet('b', 2, 5000)
    cacheFlush()
    assert.equal(cacheGet('a'), null)
    assert.equal(cacheGet('b'), null)
  })
})

describe('cacheMemo', () => {
  it('calls loader on first access and returns its value', async () => {
    cacheFlush()
    let calls = 0
    const result = await cacheMemo('memo1', async () => { calls++; return 42 }, 5000)
    assert.equal(result, 42)
    assert.equal(calls, 1)
  })

  it('returns cached value on second access without calling loader again', async () => {
    cacheFlush()
    let calls = 0
    const loader = async () => { calls++; return 'cached' }
    await cacheMemo('memo2', loader, 5000)
    const second = await cacheMemo('memo2', loader, 5000)
    assert.equal(second, 'cached')
    assert.equal(calls, 1)
  })

  it('de-duplicates concurrent calls to the same key', async () => {
    cacheFlush()
    let calls = 0
    const loader = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return 'result'
    }
    const [r1, r2] = await Promise.all([
      cacheMemo('concurrent', loader, 5000),
      cacheMemo('concurrent', loader, 5000),
    ])
    assert.equal(r1, 'result')
    assert.equal(r2, 'result')
    assert.equal(calls, 1)
  })

  it('re-invokes loader after flush', async () => {
    cacheFlush()
    let calls = 0
    await cacheMemo('refetch', async () => { calls++; return 1 }, 5000)
    cacheFlush('refetch')
    await cacheMemo('refetch', async () => { calls++; return 2 }, 5000)
    assert.equal(calls, 2)
  })
})
