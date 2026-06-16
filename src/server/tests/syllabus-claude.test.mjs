/**
 * Unit tests for the Claude wrapper. We don't make real API calls here  * those are exercised end-to-end via the dev server. The tests below cover
 * the configuration paths.
 */
import assert from 'node:assert'
import { describe, it } from 'node:test'

describe('extractSyllabus', () => {
  it('throws NO_API_KEY when ANTHROPIC_API_KEY is unset', async () => {
    // Save and clear the env var in case the runner has it configured.
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    // Import after clearing so the module's lazy client builder picks up the
    // missing env. (Our buildClient() is per-call, so import timing isn't
    // strictly required  but staying explicit keeps the test honest.)
    const { extractSyllabus } = await import('../syllabus-claude.js')

    try {
      await assert.rejects(
        () => extractSyllabus('CS 3340 Algorithms\n\nProblem Set 1 due Sept 5'),
        (err) => err?.code === 'NO_API_KEY'
      )
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
  })
})
