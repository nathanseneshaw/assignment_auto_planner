import {
  BlackboardHttpSession,
  extractCourseIdFromHref,
  parseCourseDisplayFields,
} from './blackboard-http-session.js'

/**
 * Backward-compatible facade for POST /api/blackboard/login|course|sync.
 * Uses cookie-based HTTP scraping (no browser automation).
 */
export class BlackboardScraper {
  /**
   * @param {string} baseUrl
   * @param {string} username
   * @param {string} password
   * @param {string} [learnBaseUrl] Hosted Learn origin if different from vanity URL
   */
  constructor(baseUrl, username, password, learnBaseUrl = null) {
    this._bb = new BlackboardHttpSession({
      entryUrl: baseUrl,
      learnBaseUrl: learnBaseUrl || undefined,
      username,
      password,
    })
    this.sessionId = null
  }

  getSessionId() {
    return this.sessionId
  }

  async login() {
    const r = await this._bb.login()
    if (r.success) {
      this.sessionId = `bb-${Date.now()}`
    }
    return r
  }

  async getCourses() {
    if (!this._bb.isLoggedIn) {
      throw new Error('Not logged in')
    }
    await this._bb.enableInstructorsAndYearSeason()
    await this._bb.getCourses()
    return Object.entries(this._bb.courses).map(([fullName, href]) => {
      const id = extractCourseIdFromHref(href) || fullName
      const { code, term, instructor, shortName } =
        parseCourseDisplayFields(fullName)
      return {
        id,
        name: shortName || fullName,
        code,
        term,
        fullName,
        instructor,
      }
    })
  }

  async getCourseAssignments(courseId) {
    if (!this._bb.isLoggedIn) {
      throw new Error('Not logged in')
    }
    const entry = Object.entries(this._bb.courses).find(
      ([, h]) =>
        extractCourseIdFromHref(h) === courseId || h.includes(courseId)
    )
    if (!entry) {
      return []
    }
    const [displayName, href] = entry
    const rows = await this._bb.collectGradesLikeFromCourse(
      displayName,
      href,
      courseId
    )
    return rows.map((a) => ({
      title: a.title,
      description: a.description || '',
      dueDate: a.dueDate,
      type: a.type,
      blackboardId: a.id,
      url: a.sourceUrl || null,
    }))
  }
}
