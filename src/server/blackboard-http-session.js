/**
 * Cookie-authenticated Blackboard "Learn" scraping (HTTP + HTML parsing).
 * Mirrors the Python implementation spec: SSO/Spring-style login, portal module
 * configuration, course discovery, menu crawl, and assignment extraction.
 */

import { CookieJar } from 'tough-cookie'
import fetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
import { parseBlackboardGradesHtml } from './lms-grades-parse.js'
import {
  parseBlackboardCourseDisplayFields,
  looksLikeBlackboardCourseListEntry,
} from '../utils/blackboardCourseName.js'

const PORTAL_TAB_GROUP = '_1_1'
const PORTAL_MODULE = '_4_1'

function normalizeOrigin(input) {
  if (!input) return ''
  let u = String(input).trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    const url = new URL(u)
    return url.origin
  } catch {
    return ''
  }
}

function resolveLearnOrigin(entryOrigin, learnBaseUrl) {
  const explicit = normalizeOrigin(learnBaseUrl)
  if (explicit) return explicit
  return entryOrigin
}

/**
 * Detect IdP / federated login surfaces the HTTP scraper cannot complete alone.
 * @param {string} html
 * @param {string} url
 */
export function looksLikeSsoChallenge(html, url) {
  const u = String(url || '').toLowerCase()
  const h = String(html || '').toLowerCase()
  if (
    /saml|shibboleth|\/idp\/|federationmetadata|cas\/login|oauth2\/authorize|openid|auth-saml|auth\/realms\/|\/sso\/|duosecurity|okta\.com|login\.microsoftonline|onelogin\.com|pingidentity|auth0\.com/.test(
      u
    )
  ) {
    return true
  }
  if (
    /<form[^>]+action=["'][^"']*saml/i.test(h) ||
    h.includes('name="samlresponse"') ||
    h.includes('relaystate') && h.includes('saml')
  ) {
    return true
  }
  if (
    h.includes('single sign-on') ||
    h.includes('single sign on') ||
    h.includes('shibboleth') ||
    h.includes('federated login') ||
    h.includes('external login') ||
    (h.includes('saml') && h.includes('login'))
  ) {
    return true
  }
  return false
}

/**
 * @param {string} href
 */
export function extractCourseIdFromHref(href) {
  if (!href) return null
  const idParam = href.match(/[?&]id=([^&]+)/i)
  if (idParam) return decodeURIComponent(idParam[1])
  const cid = href.match(/course_id=([^&]+)/i)
  if (cid) return decodeURIComponent(cid[1])
  return null
}

/**
 * @param {string} name raw portal title (may include instructor / announcements tail)
 */
export function parseCourseDisplayFields(name) {
  return parseBlackboardCourseDisplayFields(name)
}

async function mapPool(limit, items, mapper) {
  if (items.length === 0) return []
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () =>
      (async function worker() {
        for (;;) {
          const i = cursor++
          if (i >= items.length) break
          results[i] = await mapper(items[i], i)
        }
      })()
  )
  await Promise.all(workers)
  return results
}

export class BlackboardHttpSession {
  /**
   * @param {object} opts
   * @param {string} opts.entryUrl Institution vanity URL origin (e.g. https://blackboard.kettering.edu)
   * @param {string} [opts.learnBaseUrl] Hosted Learn origin (e.g. https://kettering.blackboard.com); defaults to entryUrl
   * @param {string} opts.username
   * @param {string} opts.password
   * @param {number} [opts.maxThreads]
   */
  constructor(opts) {
    const { entryUrl, learnBaseUrl, username, password, maxThreads = 12 } = opts
    this.entryOrigin = normalizeOrigin(entryUrl)
    this.learnOrigin = resolveLearnOrigin(this.entryOrigin, learnBaseUrl)
    this.username = username || ''
    this.password = password || ''
    this.maxThreads = maxThreads

    this.cookieJar = new CookieJar()
    this.fetch = fetchCookie(fetch, this.cookieJar)

    this.courses = {}
    this.downloadTasks = []
    this.isLoggedIn = false
    this.instructorsFound = false
    this.courseFound = false
    this.response = null
    this.lastActivityTime = null
  }

  setResponse(msg) {
    this.response = msg
  }

  getResponse() {
    return this.response
  }

  setInstructorsFound(v) {
    this.instructorsFound = !!v
  }

  getInstructorsFound() {
    return this.instructorsFound
  }

  async _getInitialUrlResponse(url) {
    return this.fetch(url, { method: 'GET', redirect: 'manual' })
  }

  async _handleRedirect(response) {
    if (response.status < 300 || response.status >= 400) return response
    const loc = response.headers.get('location')
    if (!loc) return response
    const next = new URL(loc, response.url || this.entryOrigin).href
    return this.fetch(next, { method: 'GET', redirect: 'follow' })
  }

  async _sendPostRequest(url, data, allowRedirects = true) {
    const body =
      typeof data === 'string'
        ? data
        : new URLSearchParams(data).toString()
    return this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: allowRedirects ? 'follow' : 'manual',
    })
  }

  async _getRequest(url) {
    return this.fetch(url, { method: 'GET', redirect: 'follow' })
  }

  /**
   * Apply cookies captured from a real browser (e.g. Playwright after SSO).
   * @param {Array<{ name: string, value: string, domain?: string, path?: string, secure?: boolean, httpOnly?: boolean, sameSite?: string }>} cookies
   */
  async applyPlaywrightCookies(cookies) {
    for (const c of cookies) {
      if (!c || !c.name) continue
      const path = c.path || '/'
      let domain = String(c.domain || '').trim()
      if (!domain) continue
      const host = domain.startsWith('.') ? domain.slice(1) : domain
      const url = `https://${host.replace(/:\d+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
      const attrs = [`${c.name}=${c.value}`, `Path=${path}`, `Domain=${domain}`]
      if (c.secure) attrs.push('Secure')
      if (c.httpOnly) attrs.push('HttpOnly')
      if (c.sameSite && String(c.sameSite).toLowerCase() !== 'none') {
        attrs.push(`SameSite=${c.sameSite}`)
      }
      const cookieStr = attrs.join('; ')
      try {
        await new Promise((resolve, reject) => {
          this.cookieJar.setCookie(cookieStr, url, { ignoreErrors: true }, (err, cookie) => {
            if (err) reject(err)
            else resolve(cookie)
          })
        })
      } catch {
        try {
          this.cookieJar.setCookieSync(cookieStr, url, { ignoreErrors: true })
        } catch {
          /* best-effort */
        }
      }
    }
  }

  /**
   * After cookie import, verify we can load the portal (or another authenticated surface).
   */
  async verifyCookieSession() {
    const origins = [this.learnOrigin, this.entryOrigin].filter(
      (v, i, a) => v && a.indexOf(v) === i
    )
    for (const origin of origins) {
      try {
        const probe = `${origin}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1`
        const res = await this._getRequest(probe)
        const html = await res.text()
        const finalUrl = (res.url || '').toLowerCase()
        if (
          finalUrl.includes('/webapps/portal') ||
          html.includes('global-nav') ||
          html.includes('Log Out') ||
          html.includes('logout') ||
          html.includes('course_id=') ||
          html.includes('My Blackboard') ||
          html.includes('My Institution')
        ) {
          if (
            finalUrl.includes('/webapps/login') &&
            html.toLowerCase().includes('password') &&
            html.toLowerCase().includes('user_id')
          ) {
            continue
          }
          this.isLoggedIn = true
          this.response = null
          this.lastActivityTime = Date.now()
          return true
        }
      } catch {
        /* try next origin */
      }
    }
    return false
  }

  /**
   * Spring / SSO style flow first; falls back to native Learn login form.
   */
  async login() {
    if (this.isLoggedIn) {
      this.setResponse('Already logged in.')
      return { success: false, error: this.response }
    }

    try {
      let entry = `${this.entryOrigin}/`
      let r = await this._getInitialUrlResponse(entry)
      r = await this._handleRedirect(r)

      r = await this._sendPostRequest(r.url, { _eventId_proceed: '' })
      const proceedHtml = await r.text()

      let executionValue
      try {
        const u = new URL(r.url)
        executionValue = u.searchParams.get('execution')
        if (!executionValue && r.url.includes('execution=')) {
          executionValue = r.url.split('execution=')[1].split('&')[0]
        }
      } catch {
        executionValue = null
      }

      if (!executionValue && looksLikeSsoChallenge(proceedHtml, r.url)) {
        this.isLoggedIn = false
        this.setResponse(
          'Your school uses single sign-on (SSO). Use “Sign in with browser” to complete login.'
        )
        return { success: false, error: this.response, needsSso: true }
      }

      if (executionValue) {
        const intLoginPageResponse = r
        const finalPayload = {
          execution: executionValue,
          j_username: this.username,
          j_password: this.password,
          _eventId_proceed: '',
        }
        const loginSendResponse = await this._sendPostRequest(
          intLoginPageResponse.url,
          finalPayload
        )
        const html = await loginSendResponse.text()
        const $ = cheerio.load(html)
        const danger = $('.alert.alert-danger').first().text().trim() || null

        if (
          loginSendResponse.url !== intLoginPageResponse.url &&
          !danger
        ) {
          this.isLoggedIn = true
          this.setResponse('Login successful.')
          this.lastActivityTime = Date.now()
          return { success: true }
        }
        this.isLoggedIn = false
        if (looksLikeSsoChallenge(html, loginSendResponse.url)) {
          this.setResponse(
            'Your school may use SSO for Blackboard. Use “Sign in with browser” to continue.'
          )
          return { success: false, error: this.response, needsSso: true }
        }
        this.setResponse(danger || 'Login failed.')
        return { success: false, error: this.response }
      }

      // Fallback: classic Learn POST /webapps/login/
      const loginUrl = `${this.learnOrigin}/webapps/login/`
      const formData = new URLSearchParams({
        user_id: this.username,
        password: this.password,
        login: 'Login',
        action: 'login',
        new_loc: '',
      })
      const loginRes = await this.fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        redirect: 'follow',
      })
      const loginHtml = await loginRes.text()
      if (
        loginHtml.includes('loginErrorMessage') ||
        loginHtml.toLowerCase().includes('invalid username') ||
        loginHtml.toLowerCase().includes('password was incorrect')
      ) {
        this.isLoggedIn = false
        this.setResponse('Invalid username or password.')
        return { success: false, error: this.response }
      }
      if (
        loginRes.url.includes('/webapps/portal') ||
        loginHtml.includes('global-nav') ||
        loginHtml.includes('Log Out')
      ) {
        this.isLoggedIn = true
        this.setResponse('Login successful.')
        this.lastActivityTime = Date.now()
        return { success: true }
      }
      this.isLoggedIn = false
      if (looksLikeSsoChallenge(loginHtml, loginRes.url)) {
        this.setResponse(
          'Your school uses single sign-on (SSO). Use “Sign in with browser” to complete login.'
        )
        return { success: false, error: this.response, needsSso: true }
      }
      this.setResponse('Unable to verify login for this institution URL.')
      return { success: false, error: this.response }
    } catch (e) {
      console.error('[BlackboardHttpSession] login:', e)
      this.isLoggedIn = false
      this.setResponse(`Connection failed: ${e.message}`)
      return { success: false, error: this.response }
    }
  }

  async enableInstructorsAndYearSeason() {
    const getUrl =
      `${this.learnOrigin}/webapps/portal/execute/tabs/tabAction?` +
      `tab_tab_group_id=${PORTAL_TAB_GROUP}&` +
      `forwardUrl=edit_module%2F${PORTAL_MODULE}%2Fbbcourseorg%3Fcmd%3Dedit&` +
      `recallUrl=%2Fwebapps%2Fportal%2Fexecute%2Ftabs%2FtabAction%3Ftab_tab_group_id%3D${PORTAL_TAB_GROUP}`

    const getRes = await this._getRequest(getUrl)
    const soup = cheerio.load(await getRes.text())

    const courseRows = soup(
      'tbody[id*="blockAttributes_table_jsListFULL_Student"] tr'
    ).toArray()

    const courseIds = []
    for (const row of courseRows) {
      const id = soup(row).attr('id') || ''
      const m = id.match(/FULL_Student_\d+_\d+_row:_(\d+_\d+)/)
      if (m) courseIds.push(m[1])
    }

    const termRows = soup('#termDisplay_table_jsListTermDisplay tbody tr').toArray()
    const termIds = []
    for (const row of termRows) {
      const id = soup(row).attr('id') || ''
      const m = id.match(/termDisplay_table_jsListTermDisplay_row:_(\d+_\d+)/)
      if (m) termIds.push(m[1])
    }

    const url =
      `${this.learnOrigin}/webapps/portal/execute/tabs/tabAction?` +
      `tab_tab_group_id=${PORTAL_TAB_GROUP}&` +
      `forwardUrl=proc_edit%2F${PORTAL_MODULE}%2Fbbcourseorg&` +
      `recallUrl=%2Fwebapps%2Fportal%2Fexecute%2Ftabs%2FtabAction%3Ftab_tab_group_id%3D${PORTAL_TAB_GROUP}`

    /** @type {Record<string, string>} */
    const payload = {}
    soup('#moduleEditForm input[type="hidden"]').each((_, inp) => {
      const name = soup(inp).attr('name')
      if (name) payload[name] = soup(inp).attr('value') || ''
    })
    if (Object.keys(payload).length === 0) {
      this.setInstructorsFound(false)
      return
    }

    Object.assign(payload, {
      cmd: 'processEdit',
      'amc.action': 'processCourseEdit',
      'amc.withinModule': 'true',
      'amc.showSearch': 'false',
      'amc.isWizard': 'false',
      'amc.cmd.back': '',
      'amc.instructorOrder': '0',
      'bundleEntryBlackboard_1.value': '',
      'bundleEntryBlackboard_1.label': '',
      'amc.showcourseheading': 'true',
      'amc.showinstructorheading': 'true',
      'amc.showcourseidheading': 'true',
      bottom_Submit: 'Submit',
    })

    for (const c of courseIds) {
      payload[`amc.showcourse._${c}`] = 'true'
      payload[`amc.showcourseid._${c}`] = 'true'
      payload[`amc.showinstructors._${c}`] = 'true'
    }
    for (const t of termIds) {
      payload['amc.groupbyterm'] = 'true'
      payload[`selectAll_${t}`] = 'true'
      payload[`amc.showterm._${t}`] = 'true'
      payload[`termCourses__${t}`] = 'true'
    }

    const enableRes = await this._sendPostRequest(url, payload, false)
    if (enableRes.status === 302 && enableRes.headers.get('location')) {
      await this._getRequest(
        new URL(enableRes.headers.get('location'), url).href
      )
      this.setInstructorsFound(true)
    } else {
      this.setInstructorsFound(false)
    }
  }

  async getCourses() {
    const formData = {
      action: 'refreshAjaxModule',
      modId: PORTAL_MODULE,
      tabId: PORTAL_TAB_GROUP,
      tab_tab_group_id: PORTAL_TAB_GROUP,
    }
    const url = `${this.learnOrigin}/webapps/portal/execute/tabs/tabAction`
    const getCoursesResponse = await this._sendPostRequest(url, formData)
    const html = await getCoursesResponse.text()
    const soup = cheerio.load(html)

    const noCoursesText = 'You are not currently enrolled in any courses.'
    if (html.includes(noCoursesText)) {
      this.setResponse(noCoursesText)
      this.courseFound = false
      return
    }

    const courseDetails = {}
    const seasonYear = {}
    soup('div[id^="_4_1termCourses"]').each((_, div) => {
      const el = soup(div)
      const divId = el.attr('id') || ''
      const idm = divId.match(/(\d+_\d+)/)
      if (!idm) return
      const courseId = idm[1]
      const divText = el.text()
      const cm =
        divText.match(/([A-Z]+-[0-9]+-[0-9]+[A-Z]?)|([A-Z]+-[0-9]+)/i) ||
        divText.match(/\b([A-Z]{2,10}\s+\d{4}(?:\.\d{2,4})?)\b/i)
      if (cm) {
        courseDetails[cm[0]] = courseId
      }
    })

    soup('a[id^="afor_4_1termCourses__"]').each((_, a) => {
      const el = soup(a)
      const headerId = el.attr('id') || ''
      const hm = headerId.match(/afor_4_1termCourses__(\d+_\d+)/)
      if (!hm) return
      const headerCourseId = hm[1]
      const m = el.text().match(/(Spring|Summer|Fall|Winter)\s+(\d{4})/)
      if (m) seasonYear[headerCourseId] = [m[1], m[2]]
    })

    const courseSeasonMapping = {}
    for (const [code, cid] of Object.entries(courseDetails)) {
      if (seasonYear[cid]) {
        courseSeasonMapping[cid] = seasonYear[cid]
      }
    }

    const hrefs = {}
    for (const div of soup('div[id^="_4_1termCourses"]').toArray()) {
      const listItems = soup(div).find('ul li')
      listItems.each((_, li) => {
        const $li = soup(li)
        const anchors = $li.find('a').toArray()
        let chosenText = ''
        let chosenHref = ''
        for (const a of anchors) {
          const $a = soup(a)
          const linkText = $a.text().replace(/\s+/g, ' ').trim()
          const href = ($a.attr('href') || '').trim()
          if (!href || !linkText) continue
          if (looksLikeBlackboardCourseListEntry(linkText)) {
            chosenText = linkText
            chosenHref = href
            break
          }
        }
        if (!chosenText && anchors.length) {
          const $a = soup(anchors[0])
          const linkText = $a.text().replace(/\s+/g, ' ').trim()
          const href = ($a.attr('href') || '').trim()
          if (href && looksLikeBlackboardCourseListEntry(linkText)) {
            chosenText = linkText
            chosenHref = href
          }
        }
        if (chosenText && chosenHref) hrefs[chosenText] = chosenHref
      })
    }

    if (this.instructorsFound) {
      const oldKeys = Object.keys(hrefs)
      for (const text of oldKeys) {
        let liEl = null
        soup('div[id^="_4_1termCourses"] ul li').each((_, el) => {
          if (liEl) return
          const hit = soup(el)
            .find('a')
            .toArray()
            .some(
              (a) =>
                soup(a).text().replace(/\s+/g, ' ').trim() === text
            )
          if (hit) liEl = el
        })
        if (!liEl) continue
        const li = soup(liEl)

        let lastName = 'No Instructor'
        const nameSpan = li.find('div span.name').first()
        if (nameSpan.length) {
          const bits = nameSpan.text().trim().split(/\s+/)
          lastName = bits[bits.length - 1] || lastName
        }
        const cm =
          li
            .text()
            .match(/([A-Z]+-[0-9]+-[0-9]+[A-Z]?)|([A-Z]+-[0-9]+)/i) ||
          li.text().match(/\b([A-Z]{2,10}\s+\d{4}(?:\.\d{2,4})?)\b/i)
        if (!cm) continue
        const courseCode = cm[0]
        if (!courseDetails[courseCode]) continue
        const courseId = courseDetails[courseCode]
        const sy = courseSeasonMapping[courseId]
        if (!sy) continue
        const [season, year] = sy
        const formatted = `${courseCode}, ${lastName}, ${season} ${year}`
        if (hrefs[text]) {
          hrefs[formatted] = hrefs[text]
          delete hrefs[text]
        }
      }
    }

    this.courses = hrefs
    this.courseFound = Object.keys(hrefs).length > 0
    if (this.courseFound) {
      this.response = null
    }
  }

  /**
   * @returns {Promise<Array<[string, string, string]>>}
   */
  async getDownloadTasks() {
    this.downloadTasks = []
    const hrefs = this.courses
    const entries = Object.entries(hrefs)
    if (entries.length === 0) return []

    const self = this
    async function processCourse(courseName, href) {
      const safeCourse = courseName.replace(/[\\/:*?"<>|]/g, '').replace(/\n/g, '')
      const fullUrl = href.startsWith('http')
        ? href
        : `${self.learnOrigin}${href}`
      let pageRes
      try {
        pageRes = await self._getRequest(fullUrl)
      } catch {
        return
      }
      const soup = cheerio.load(await pageRes.text())
      const courseMenu = soup('#courseMenuPalette_contents')
      if (!courseMenu.length) return

      for (const node of courseMenu.contents().toArray()) {
        if (node.type !== 'tag') continue
        const li = soup(node)
        if (li.prop('tagName')?.toLowerCase() !== 'li') continue
        let mhref = li.find('a').first().attr('href')
        if (!mhref || mhref[0] !== '/') continue
        let menuUrl = `${self.learnOrigin}${mhref}`
        let menuRes
        try {
          menuRes = await self._getRequest(menuUrl)
        } catch {
          continue
        }
        const msoup = cheerio.load(await menuRes.text())
        const contentList = msoup('#containerdiv')
        if (!contentList.length) continue
        for (const contentLi of contentList.find('li').toArray()) {
          const rawText =
            msoup(contentLi).text().trim().split('\n')[0] || 'Untitled'
          const assignmentName = rawText.replace(/[\\/:*?"<>|]/g, '_')
          const a = msoup(contentLi).find('.details a').first()
          if (!a.length) continue
          const ah = a.attr('href') || ''
          if (ah[0] === 'h') continue
          const fileUrl = ah.startsWith('http')
            ? ah
            : `${self.learnOrigin}${ah}`
          self.downloadTasks.push([safeCourse, assignmentName, fileUrl])
        }
      }
    }

    await mapPool(this.maxThreads, entries, async ([name, href]) => {
      await processCourse(name, href)
    })
    return this.downloadTasks
  }

  /**
   * Visits course menu targets and parses grades-style HTML for due dates.
   * @param {string} courseDisplayName
   * @param {string} href
   * @param {string} courseId
   */
  async collectGradesLikeFromCourse(courseDisplayName, href, courseId) {
    const collected = []
    const fullUrl = href.startsWith('http') ? href : `${this.learnOrigin}${href}`
    let pageRes
    try {
      pageRes = await this._getRequest(fullUrl)
    } catch {
      return collected
    }
    const soup = cheerio.load(await pageRes.text())
    const courseMenu = soup('#courseMenuPalette_contents')
    if (!courseMenu.length) return collected

    const menuHrefs = []
    for (const node of courseMenu.contents().toArray()) {
      if (node.type !== 'tag') continue
      const li = soup(node)
      if (li.prop('tagName')?.toLowerCase() !== 'li') continue
      const mhref = li.find('a').first().attr('href')
      if (mhref && mhref[0] === '/') menuHrefs.push(mhref)
    }

    for (const mhref of menuHrefs) {
      const menuUrl = `${this.learnOrigin}${mhref}`
      let menuRes
      try {
        menuRes = await this._getRequest(menuUrl)
      } catch {
        continue
      }
      const inner = await menuRes.text()
      const parsed = parseBlackboardGradesHtml(
        inner,
        courseId,
        courseDisplayName,
        this.learnOrigin
      )
      for (const a of parsed) collected.push(a)
    }
    return collected
  }

  /**
   * Full sync payload for the SPA (courses + assignments + errors).
   */
  async syncToAppResults(onProgress) {
    const results = {
      courses: [],
      assignments: [],
      errors: [],
    }

    if (!this.isLoggedIn) {
      results.errors.push({
        course: 'General',
        error: 'Not logged in.',
      })
      return results
    }

    try {
      onProgress?.({ phase: 'portal', message: 'Enabling instructor/term display…' })
      await this.enableInstructorsAndYearSeason()
      if (!this.getInstructorsFound()) {
        this.setResponse('No instructors found.')
      }

      onProgress?.({ phase: 'courses', message: 'Loading course list…' })
      await this.getCourses()

      if (this.response && !this.courseFound) {
        results.errors.push({ course: 'General', error: this.response })
        return results
      }

      const hrefEntries = Object.entries(this.courses)
      if (hrefEntries.length === 0) {
        results.errors.push({
          course: 'General',
          error: 'No courses found in portal module.',
        })
        return results
      }

      for (const [displayName, path] of hrefEntries) {
        const id = extractCourseIdFromHref(path) || displayName
        const { code, term, instructor, shortName } =
          parseCourseDisplayFields(displayName)
        results.courses.push({
          id,
          name: shortName || displayName,
          code,
          term,
          fullName: displayName,
          instructor,
        })
      }

      onProgress?.({
        phase: 'assignments',
        message: `Scraping ${hrefEntries.length} course(s)…`,
      })

      let idx = 0
      for (const [displayName, path] of hrefEntries) {
        idx += 1
        const courseId = extractCourseIdFromHref(path) || displayName
        onProgress?.({
          phase: 'assignments',
          current: idx,
          total: hrefEntries.length,
          courseName: displayName,
        })
        try {
          const found = await this.collectGradesLikeFromCourse(
            displayName,
            path,
            courseId
          )
          for (const a of found) results.assignments.push(a)
        } catch (e) {
          results.errors.push({ course: displayName, error: e.message })
        }
      }

      try {
        await this.getDownloadTasks()
        const sanitizeFolder = (s) =>
          String(s)
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\n/g, '')
            .trim()
        const seen = new Set(results.assignments.map((a) => `${a.courseId}|${a.title}`))
        for (const [cname, aname] of this.downloadTasks.map((t) => [t[0], t[1]])) {
          const course = results.courses.find(
            (x) =>
              sanitizeFolder(x.fullName) === cname ||
              sanitizeFolder(x.name) === cname ||
              x.fullName === cname ||
              x.name === cname
          )
          const cid = course?.id || cname
          const key = `${cid}|${aname}`
          if (seen.has(key)) continue
          seen.add(key)
          results.assignments.push({
            id: `${cid}_${aname.slice(0, 48)}`.replace(/\s/g, '_'),
            title: aname,
            description: '',
            dueDate: null,
            courseId: cid,
            courseName: course?.fullName || cname,
            images: [],
            type: 'assignment',
            sourceUrl: '',
          })
        }
      } catch (e) {
        results.errors.push({ course: 'General', error: e.message })
      }

      this.response = null
      this.lastActivityTime = Date.now()
      return results
    } catch (e) {
      console.error('[BlackboardHttpSession] sync:', e)
      results.errors.push({ course: 'General', error: e.message })
      return results
    }
  }
}
