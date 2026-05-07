import assert from 'node:assert'
import { describe, it } from 'node:test'

/** Mirrors src/services/lmsSupabaseSync resolveExternalAssignmentId for stable dedupe keys. */
function resolveExternalAssignmentId(assignment) {
  if (assignment.canvasAssignmentId != null && String(assignment.canvasAssignmentId).trim() !== '') {
    return String(assignment.canvasAssignmentId).trim()
  }
  if (assignment.blackboardId != null && String(assignment.blackboardId).trim() !== '') {
    return String(assignment.blackboardId).trim()
  }
  return null
}

describe('resolveExternalAssignmentId (dedupe key)', () => {
  it('prefers Canvas id when both are present', () => {
    assert.equal(
      resolveExternalAssignmentId({ canvasAssignmentId: '10', blackboardId: '20' }),
      '10'
    )
  })

  it('falls back to Blackboard id', () => {
    assert.equal(resolveExternalAssignmentId({ blackboardId: ' 99 ' }), '99')
  })

  it('returns null when neither id exists', () => {
    assert.equal(resolveExternalAssignmentId({ title: 'x' }), null)
  })
})
