// Content script that runs on Blackboard pages
// Extracts courses and assignments from the page

(function() {
  'use strict';

  const BASE_URL = window.location.origin;

  /** Keep in sync with src/utils/blackboardCourseName.js */
  function extractInstructorFromBlackboardRaw(raw) {
    if (!raw || typeof raw !== 'string') return '';
    var m = raw.match(/\bInstructor:\s*([^;]+)/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  }

  /** Keep in sync with src/utils/blackboardCourseName.js */
  function sanitizeBlackboardCourseDisplayName(raw) {
    if (raw == null || typeof raw !== 'string') return '';
    var s = raw.replace(/\s+/g, ' ').trim();
    var semiAnn = s.search(/;\s*Announcements?\s*:/i);
    if (semiAnn >= 0) s = s.slice(0, semiAnn).trim();
    var cutMarkers = [
      /\s+Instructor\s*:/i,
      /\s+Instructors\s*:/i,
      /\s+Announcement\s*:/i,
      /\s+Announcements\s*:/i
    ];
    for (var ci = 0; ci < cutMarkers.length; ci++) {
      var idx = s.search(cutMarkers[ci]);
      if (idx >= 0) s = s.slice(0, idx).trim();
    }
    s = s.replace(/\s+-\s+([A-Z]{1,4}\d{2,4})\s*$/i, '').trim();
    return s;
  }

  /** Keep in sync with src/utils/blackboardCourseName.js */
  function looksLikeBlackboardCourseListEntry(text) {
    if (!text || typeof text !== 'string') return false;
    var t = text.replace(/\s+/g, ' ').trim();
    if (t.length < 8 || t.length > 500) return false;
    if (/\b[A-Z]{2,10}\s+\d{4}(?:\.\d{2,4})?\b/i.test(t)) return true;
    if (/\b[A-Z]{2,10}-\d{3,5}(?:-\d{2,4}[A-Z]?)?\b/i.test(t)) return true;
    if (/^(book|click|please|view|read)\s+a\s+/i.test(t)) return false;
    if (/\bAnnouncements?\s*:/i.test(t)) return false;
    return false;
  }

  // Check if we're on a Blackboard page (works with any institution)
  function isBlackboardPage() {
    const url = window.location.href.toLowerCase();
    
    // URL patterns that indicate Blackboard
    const urlPatterns = [
      'blackboard', '/ultra/', '/webapps/', '/bbcswebdav/',
      'learn.', 'elearning', 'lms.', 'courses.'
    ];
    const isBlackboardUrl = urlPatterns.some(p => url.includes(p));
    
    // DOM elements unique to Blackboard
    const blackboardSelectors = [
      '[data-course-id]',
      '.course-org-list',
      '#My_Courses',
      '.stream_course',
      '[class*="base-navigation"]',
      '[class*="ultra-"]',
      'bb-base-layout',
      '#Learn_LEARN',
      '.portletList-img',
      '#content_listContainer',
      '[class*="bb-"]'
    ];
    const hasBlackboardElements = blackboardSelectors.some(s => document.querySelector(s) !== null);
    
    return isBlackboardUrl || hasBlackboardElements;
  }

  // Check if user is logged in
  function isLoggedIn() {
    // Check for logout links/buttons
    const hasLogout = document.querySelector('[href*="logout"]') !== null ||
           document.querySelector('#logout') !== null ||
           document.querySelector('.logout') !== null ||
           document.querySelector('[data-item-id="signOut"]') !== null ||
           document.querySelector('a[href*="webapps/login?action=logout"]') !== null;
    
    // Check for user menu / profile indicators
    const hasUserProfile = document.querySelector('[class*="user-avatar"]') !== null ||
           document.querySelector('[class*="user-name"]') !== null ||
           document.querySelector('[data-item-id="settings"]') !== null ||
           document.querySelector('.profile-button') !== null;
    
    // Check if we can see navigation (only visible when logged in)
    const hasNav = document.querySelector('nav') !== null ||
           document.querySelector('[role="navigation"]') !== null ||
           document.querySelector('.base-navigation') !== null;
    
    // Check for text indicators
    const bodyText = document.body.innerHTML;
    const hasLogoutText = bodyText.includes('Log Out') || 
                          bodyText.includes('Sign Out') ||
                          bodyText.includes('Sign out');
    
    return hasLogout || hasUserProfile || (hasNav && !window.location.href.includes('login'));
  }

  // Check if a course element indicates the course is locked/unavailable
  function isCourseAvailable(element) {
    // Check the element and its parent for lock indicators
    const container = element.closest('li, div, tr') || element.parentElement;
    if (!container) return true;
    
    const containerText = container.textContent.toLowerCase();
    const containerHtml = container.innerHTML.toLowerCase();
    
    // Check for lock icons
    const hasLockIcon = container.querySelector('img[alt*="lock"], img[alt*="Lock"], img[src*="lock"], .locked-icon, [class*="lock"]') !== null;
    
    // Check for unavailable text
    const unavailablePatterns = [
      'unavailable',
      'not available',
      'course unavailable',
      'access denied',
      'restricted',
      'closed',
      'ended',
      'expired'
    ];
    
    const hasUnavailableText = unavailablePatterns.some(pattern => containerText.includes(pattern));
    
    // Check for visual indicators in class names
    const hasUnavailableClass = container.className && (
      container.className.includes('unavailable') ||
      container.className.includes('disabled') ||
      container.className.includes('locked') ||
      container.className.includes('inactive')
    );
    
    // Check for grayed out styling
    const style = window.getComputedStyle(container);
    const isGrayedOut = style.opacity < 0.5 || style.color === 'rgb(153, 153, 153)';
    
    return !hasLockIcon && !hasUnavailableText && !hasUnavailableClass && !isGrayedOut;
  }

  // Extract professor/instructor name from course element or nearby
  function extractInstructor(element) {
    const container = element.closest('li, div, tr, .course-item, .course-element') || element.parentElement;
    if (!container) return null;
    
    // Look for instructor info in various places
    const instructorSelectors = [
      '[class*="instructor"]',
      '[class*="professor"]',
      '[class*="teacher"]',
      '.courseInfoValue',
      '.course-instructor',
      '.instructor-name'
    ];
    
    for (const selector of instructorSelectors) {
      const el = container.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        if (text && text.length > 2 && text.length < 100) {
          return text;
        }
      }
    }
    
    return null;
  }

  // Extract courses from the page
  function extractCourses() {
    const courses = [];
    
    console.log('[AutoPlanner] Extracting courses from:', window.location.href);
    
    // Method 1: Course cards/links with course_id or Ultra course URLs
    document.querySelectorAll('a[href*="course_id="], a[href*="/ultra/course/"]').forEach(link => {
      const href = link.href;
      const courseIdMatch =
        href.match(/course_id=([^&]+)/) || href.match(/\/ultra\/course\/([^/?]+)/);
      if (courseIdMatch) {
        const courseId = courseIdMatch[1];
        const rawTitle = link.textContent.trim();
        
        // Skip if already added or empty
        if (courses.find(c => c.id === courseId) || !rawTitle) return;
        
        // Skip navigation/utility links
        if (rawTitle.length < 3 || rawTitle.includes('course_id')) return;
        
        if (!looksLikeBlackboardCourseListEntry(rawTitle)) return;
        
        // Skip locked/unavailable courses
        if (!isCourseAvailable(link)) {
          console.log('[AutoPlanner] Skipping locked course:', rawTitle);
          return;
        }
        
        const displayTitle = sanitizeBlackboardCourseDisplayName(rawTitle);
        const codeMatch = displayTitle.match(/^([A-Z]{2,4}\s*\d{4}[A-Z]?[-.\s]?\d*)/i);
        const code = codeMatch ? codeMatch[1].trim() : '';
        
        const termMatch = displayTitle.match(/(Fall|Spring|Summer|Winter)\s*\d{4}/i);
        const term = termMatch ? termMatch[0] : '';
        
        const instructor =
          extractInstructor(link) || extractInstructorFromBlackboardRaw(rawTitle);
        
        // Build content URL for this course
        const contentUrl = `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseId}`;
        
        courses.push({
          id: courseId,
          name: displayTitle || rawTitle,
          code: code,
          term: term,
          fullName: rawTitle,
          instructor: instructor,
          url: href,
          contentUrl: contentUrl
        });
      }
    });

    // Method 2: Ultra UI course cards
    document.querySelectorAll('[data-course-id]').forEach(el => {
      const courseId = el.getAttribute('data-course-id');
      const nameEl = el.querySelector('[class*="course-name"], [class*="title"], h3, h4');
      const nameRaw = nameEl ? nameEl.textContent.trim() : el.textContent.trim().substring(0, 100);
      if (!nameRaw || !looksLikeBlackboardCourseListEntry(nameRaw)) return;
      const name = sanitizeBlackboardCourseDisplayName(nameRaw) || nameRaw;
      
      if (courseId && !courses.find(c => c.id === courseId) && nameRaw) {
        // Skip locked courses
        if (!isCourseAvailable(el)) {
          console.log('[AutoPlanner] Skipping locked course:', nameRaw);
          return;
        }
        
        const instructor = extractInstructor(el);
        
        courses.push({
          id: courseId,
          name: name,
          code: '',
          term: '',
          fullName: nameRaw,
          instructor: instructor,
          url: `${BASE_URL}/ultra/course/${courseId}`,
          contentUrl: `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseId}`
        });
      }
    });

    // Method 3: Stream items
    document.querySelectorAll('.stream_course, .course-item, [class*="CourseCard"]').forEach(el => {
      const link = el.querySelector('a[href*="course"]');
      if (link) {
        const href = link.href;
        const courseIdMatch =
          href.match(/course_id=([^&]+)/) || href.match(/\/ultra\/course\/([^/?]+)/);
        if (courseIdMatch) {
          const courseId = courseIdMatch[1];
          const linkText = (link.textContent || '').replace(/\s+/g, ' ').trim();
          const nameRaw =
            linkText.length >= 8
              ? linkText
              : el.textContent.trim().substring(0, 100);
          if (!nameRaw || !looksLikeBlackboardCourseListEntry(nameRaw)) return;
          const name = sanitizeBlackboardCourseDisplayName(nameRaw) || nameRaw;
          
          if (!courses.find(c => c.id === courseId) && nameRaw) {
            // Skip locked courses
            if (!isCourseAvailable(el)) {
              console.log('[AutoPlanner] Skipping locked course:', nameRaw);
              return;
            }
            
            const instructor = extractInstructor(el);
            
            courses.push({
              id: courseId,
              name: name,
              code: '',
              term: '',
              fullName: nameRaw,
              instructor: instructor,
              url: href,
              contentUrl: `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseId}`
            });
          }
        }
      }
    });
    
    // Method 4: Look for sidebar/navigation course links (Ultra UI)
    document.querySelectorAll('nav a, [role="navigation"] a').forEach(link => {
      const href = link.href;
      if (!href) return;
      
      const courseIdMatch =
        href.match(/\/ultra\/course\/([^/?]+)/) || href.match(/course_id=([^&]+)/);
      if (courseIdMatch) {
        const courseId = courseIdMatch[1];
        const nameRaw = link.textContent.trim();
        if (!looksLikeBlackboardCourseListEntry(nameRaw)) return;
        const displayName = sanitizeBlackboardCourseDisplayName(nameRaw) || nameRaw;
        
        if (nameRaw && nameRaw.length > 3 && !courses.find(c => c.id === courseId)) {
          courses.push({
            id: courseId,
            name: displayName,
            code: '',
            term: '',
            fullName: nameRaw,
            instructor: null,
            url: href,
            contentUrl: `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseId}`
          });
        }
      }
    });

    console.log('[AutoPlanner] Found', courses.length, 'courses on current page');
    return courses;
  }

  // Fetch a page and parse its HTML
  async function fetchPage(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      const html = await response.text();
      const parser = new DOMParser();
      return parser.parseFromString(html, 'text/html');
    } catch (error) {
      console.error('[AutoPlanner] Failed to fetch:', url, error);
      return null;
    }
  }

  /**
   * Grades/My Grades DOM: anchor + parent block containing a DUE: line (matches server grades scraping).
   */
  function extractAssignmentsFromGradesDoc(doc, courseId, courseName) {
    const assignments = [];
    if (!doc || !doc.body) return assignments;
    const seen = new Set();

    function parseDueBlock(text) {
      if (!text) return null;
      const flat = text.replace(/\s+/g, ' ').trim();
      const patterns = [
        /DUE\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/i,
        /Due\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/i,
        /DUE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      ];
      for (let i = 0; i < patterns.length; i++) {
        const m = flat.match(patterns[i]);
        if (!m) continue;
        const d = Date.parse(m[1].trim());
        if (!isNaN(d) && new Date(d).getFullYear() >= 2020) return new Date(d).toISOString();
      }
      return null;
    }

    doc.querySelectorAll('a[href]').forEach(function (aEl) {
      const title = (aEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 2 || title.length > 500) return;
      var low = title.toLowerCase();
      if (
        ['grades', 'my grades', 'course grades', 'home'].indexOf(low) >= 0
      )
        return;

      var p = aEl.parentElement;
      for (var depth = 0; depth < 8 && p; depth++) {
        var block = (p.textContent || '').replace(/\s+/g, ' ');
        if (/DUE\s*:/i.test(block)) {
          var dueDate = parseDueBlock(block);
          if (!dueDate) return;
          var key = title + '|' + dueDate;
          if (seen.has(key)) return;
          seen.add(key);
          assignments.push({
            id: 'grade_' + courseId + '_' + title.replace(/\s+/g, '_').slice(0, 48),
            title: title,
            description: '',
            dueDate: dueDate,
            courseId: courseId,
            courseName: courseName,
            type: detectAssignmentType(title),
            url: aEl.href || null,
            images: [],
          });
          return;
        }
        p = p.parentElement;
      }
    });

    return assignments;
  }

  // Extract assignments from a course content page (parsed document)
  function extractAssignmentsFromDoc(doc, courseId, courseName) {
    const assignments = [];
    if (!doc) return assignments;

    // Method 1: Content list items
    doc.querySelectorAll('li.clearfix, li.liItem, [class*="content-item"], .contentListItem').forEach(item => {
      const link = item.querySelector('a');
      const titleEl = link || item.querySelector('[class*="item"], .item, h3, h4, span');
      const title = titleEl ? titleEl.textContent.trim() : '';
      
      if (!title || title.length < 3) return;
      
      // Check if it looks like an assignment
      const itemText = item.textContent.toLowerCase();
      const itemClass = (item.className || '').toLowerCase();
      const hasAssignmentIcon = item.querySelector('img[alt*="Assignment"], img[alt*="assignment"]') !== null;
      
      const isAssignment = hasAssignmentIcon ||
                          itemClass.includes('assignment') ||
                          /\b(assignment|homework|hw\s*\d|quiz|exam|test|project|lab\s*\d|midterm|final)\b/i.test(title) ||
                          /\b(due|submit|submission)\b/i.test(itemText);
      
      if (isAssignment) {
        // Try to find due date
        let dueDate = null;
        const itemContent = item.textContent;
        
        // Various date patterns
        const datePatterns = [
          /Due:?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
          /Due:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
          /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
          /([A-Za-z]+\s+\d{1,2},?\s*\d{4})/
        ];
        
        for (const pattern of datePatterns) {
          const match = itemContent.match(pattern);
          if (match) {
            try {
              const parsed = new Date(match[1]);
              if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2020) {
                dueDate = parsed.toISOString();
                break;
              }
            } catch (e) {}
          }
        }
        
        // Get description - leave blank if none found
        const descEl = item.querySelector('.details, .vtbegenerated, [class*="description"]');
        let description = '';
        if (descEl) {
          const descText = descEl.textContent.trim();
          // Only use if it's actual content, not just whitespace or the title repeated
          if (descText && descText.length > 3 && descText !== title) {
            description = descText.substring(0, 500);
          }
        }
        
        // Extract attached images
        const images = [];
        item.querySelectorAll('img').forEach(img => {
          const src = img.src || img.getAttribute('data-src');
          if (src && !src.includes('icon') && !src.includes('bullet') && !src.includes('spacer')) {
            // Skip tiny icons, get actual content images
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            if (width > 50 || height > 50 || (!width && !height)) {
              images.push({
                src: src,
                alt: img.alt || '',
                title: img.title || ''
              });
            }
          }
        });
        
        // Also check for images in linked content areas
        const contentArea = item.querySelector('.vtbegenerated, [class*="content"], .details');
        if (contentArea) {
          contentArea.querySelectorAll('img').forEach(img => {
            const src = img.src || img.getAttribute('data-src');
            if (src && !images.find(i => i.src === src) && 
                !src.includes('icon') && !src.includes('bullet') && !src.includes('spacer')) {
              images.push({
                src: src,
                alt: img.alt || '',
                title: img.title || ''
              });
            }
          });
        }
        
        if (!assignments.find(a => a.title === title)) {
          assignments.push({
            id: `assign_${courseId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: title,
            description: description,
            dueDate: dueDate,
            courseId: courseId,
            courseName: courseName,
            type: detectAssignmentType(title),
            url: link ? link.href : null,
            images: images.length > 0 ? images : []
          });
        }
      }
    });

    // Method 2: Gradebook/Assessment items
    doc.querySelectorAll('[class*="grade-item"], [class*="assessment"], .graded-item').forEach(item => {
      const titleEl = item.querySelector('a, [class*="title"], span');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (title && title.length > 2 && !assignments.find(a => a.title === title)) {
        assignments.push({
          id: `grade_${courseId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: title,
          description: '', // No description for gradebook items
          dueDate: null,
          courseId: courseId,
          courseName: courseName,
          type: detectAssignmentType(title),
          url: null
        });
      }
    });

    return assignments;
  }

  // Extract instructor from a course page document
  function extractInstructorFromDoc(doc) {
    if (!doc) return null;
    
    // Look for instructor info in various places on the course page
    const selectors = [
      '#courseMenuPalette_contents .instructorname',
      '#courseMenu_link .instructor',
      '.staff-info',
      '.instructor-info',
      '[class*="instructor"]',
      '.course-staff .name',
      '.contactInfo .name'
    ];
    
    for (const selector of selectors) {
      try {
        const el = doc.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          if (text && text.length > 2 && text.length < 100) {
            return text;
          }
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    
    return null;
  }

  // Check if a course page indicates the course is unavailable
  function isCoursePageAccessible(doc) {
    if (!doc) return false;
    
    const bodyText = doc.body ? doc.body.textContent.toLowerCase() : '';
    
    // Check for access denied messages
    const deniedPatterns = [
      'access denied',
      'not available',
      'course unavailable',
      'you do not have access',
      'this course is unavailable',
      'course is closed',
      'course has ended',
      'course is locked',
      'locked to students'
    ];
    
    return !deniedPatterns.some(pattern => bodyText.includes(pattern));
  }

  /** Skip fetches whose pathname includes a `/grades` segment; no classic gradebook deep links. */
  function urlPathHasGradesSegment(absoluteUrl) {
    try {
      return /\/grades(\/|$|\?|#)/i.test(new URL(absoluteUrl).pathname);
    } catch (e) {
      return true;
    }
  }

  // Outline → resolve “My Grades” from outline HTML (fetch only non-/grades hrefs, e.g. shell routes)
  async function crawlCourseContent(courseId, courseName) {
    var origin = BASE_URL.replace(/\/$/, '');
    var enc = encodeURIComponent(courseId);
    var doc = null;

    var outlineUrl = origin + '/ultra/courses/' + enc + '/cl/outline';
    var outlineDoc = await fetchPage(outlineUrl);
    if (outlineDoc && isCoursePageAccessible(outlineDoc)) {
      var anchors = outlineDoc.querySelectorAll('a');
      var i;
      for (i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var label = ((a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
        if (label !== 'my grades') continue;
        var hr = a.getAttribute('href');
        if (!hr || /^javascript:/i.test(hr) || hr === '#') continue;
        try {
          var gradesUrl = new URL(hr, origin + '/').href;
          if (urlPathHasGradesSegment(gradesUrl)) continue;
          var gdoc = await fetchPage(gradesUrl);
          if (gdoc && isCoursePageAccessible(gdoc)) {
            doc = gdoc;
            break;
          }
        } catch (e) {
          console.log('[AutoPlanner] My Grades fetch:', e.message);
        }
      }
      // Ultra: <span title="My Grades"> — link may wrap the span or sit on a parent control
      if (!doc) {
        var titled = outlineDoc.querySelectorAll('[title]');
        for (i = 0; i < titled.length; i++) {
          var tit = ((titled[i].getAttribute('title') || '').trim().toLowerCase());
          if (tit !== 'my grades') continue;
          var linkHost = titled[i].closest && titled[i].closest('a[href]');
          if (!linkHost) continue;
          hr = linkHost.getAttribute('href');
          if (!hr || /^javascript:/i.test(hr) || hr === '#') continue;
          try {
            var gradesUrlFromSpan = new URL(hr, origin + '/').href;
            if (urlPathHasGradesSegment(gradesUrlFromSpan)) continue;
            var docFromSpan = await fetchPage(gradesUrlFromSpan);
            if (docFromSpan && isCoursePageAccessible(docFromSpan)) {
              doc = docFromSpan;
              break;
            }
          } catch (e2) {
            console.log('[AutoPlanner] My Grades span→link fetch:', e2.message);
          }
        }
      }
    }

    if (!doc || !isCoursePageAccessible(doc)) {
      console.log('[AutoPlanner] Course grades not accessible:', courseName);
      return { assignments: [], instructor: null, accessible: false };
    }

    var assignments = extractAssignmentsFromGradesDoc(doc, courseId, courseName);
    return {
      assignments: assignments,
      instructor: null,
      accessible: true,
    };
  }

  // Extract courses from Ultra UI courses page
  function extractCoursesFromUltraPage(doc) {
    const courses = [];
    
    // Ultra UI course cards
    doc.querySelectorAll('[data-course-id], [class*="course-card"], [class*="CourseCard"]').forEach(el => {
      const courseId = el.getAttribute('data-course-id') || 
                       el.querySelector('[data-course-id]')?.getAttribute('data-course-id');
      
      // Try to find course link
      const link = el.querySelector('a[href*="/ultra/course/"]') || el.querySelector('a');
      const href = link?.href || '';
      const courseIdFromUrl = href.match(/\/ultra\/course\/([^/?]+)/)?.[1] || courseId;
      
      if (!courseIdFromUrl) return;
      
      const nameEl = el.querySelector('[class*="course-name"], [class*="name"], h3, h4, [class*="title"]');
      const linkTit = link ? link.textContent.replace(/\s+/g, ' ').trim() : '';
      const nameRaw = looksLikeBlackboardCourseListEntry(linkTit)
        ? linkTit
        : nameEl?.textContent?.trim() || el.textContent.trim().substring(0, 100);
      if (!nameRaw || !looksLikeBlackboardCourseListEntry(nameRaw)) return;
      const name = sanitizeBlackboardCourseDisplayName(nameRaw) || nameRaw;
      
      if (nameRaw && !courses.find(c => c.id === courseIdFromUrl)) {
        courses.push({
          id: courseIdFromUrl,
          name: name,
          code: '',
          term: '',
          fullName: nameRaw,
          instructor: null,
          url: href || `${BASE_URL}/ultra/course/${courseIdFromUrl}`,
          contentUrl: `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseIdFromUrl}`
        });
      }
    });
    
    // Also look for course links in lists
    doc.querySelectorAll('a[href*="/ultra/course/"], a[href*="course_id="]').forEach(link => {
      const href = link.href;
      const courseIdMatch =
        href.match(/\/ultra\/course\/([^/?]+)/) || href.match(/course_id=([^&]+)/);
      if (!courseIdMatch) return;
      
      const courseId = courseIdMatch[1];
      const nameRaw = link.textContent.trim();
      if (!looksLikeBlackboardCourseListEntry(nameRaw)) return;
      const name = sanitizeBlackboardCourseDisplayName(nameRaw) || nameRaw;
      
      if (nameRaw && nameRaw.length > 3 && !courses.find(c => c.id === courseId)) {
        courses.push({
          id: courseId,
          name: name,
          code: '',
          term: '',
          fullName: nameRaw,
          instructor: null,
          url: href,
          contentUrl: `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseId}`
        });
      }
    });
    
    return courses;
  }

  // Full automatic sync - crawl all courses and their assignments
  async function fullSync(progressCallback) {
    const results = {
      courses: [],
      assignments: [],
      errors: []
    };
    
    console.log('[AutoPlanner] Starting fullSync...');
    
    // First, get all courses from the current page
    let courses = extractCourses();
    console.log('[AutoPlanner] Courses on current page:', courses.length);
    
    // If no courses on current page, only fetch the Ultra /ultra/course list (no stream/portal fallbacks)
    if (courses.length === 0) {
      const courseListUrl = `${BASE_URL}/ultra/course`;
      console.log('[AutoPlanner] No courses on current page, fetching course list only:', courseListUrl);
      const doc = await fetchPage(courseListUrl);
      if (doc) {
        courses = extractCoursesFromUltraPage(doc);
        console.log('[AutoPlanner] Found', courses.length, 'courses on /ultra/course');
        if (courses.length === 0) {
          doc.querySelectorAll('a[href*="course_id="]').forEach(link => {
            const href = link.href;
            const courseIdMatch = href.match(/course_id=([^&]+)/);
            if (courseIdMatch) {
              const courseId = courseIdMatch[1];
              const rawTitle = link.textContent.trim();
              if (!looksLikeBlackboardCourseListEntry(rawTitle)) return;
              const displayTitle = sanitizeBlackboardCourseDisplayName(rawTitle) || rawTitle;
              if (rawTitle && rawTitle.length > 3 && !courses.find(c => c.id === courseId)) {
                courses.push({
                  id: courseId,
                  name: displayTitle,
                  code: '',
                  term: '',
                  fullName: rawTitle,
                  contentUrl: `${BASE_URL}/webapps/blackboard/content/listContent.jsp?course_id=${courseId}`
                });
              }
            }
          });
        }
      }
    }
    
    // If still no courses, return early with helpful error
    if (courses.length === 0) {
      console.log('[AutoPlanner] No courses found. User may need to navigate to courses page.');
      results.errors.push({ 
        course: 'General', 
        error: 'No courses found. Try clicking "Courses" in the sidebar first.' 
      });
      return results;
    }
    
    results.courses = courses;
    console.log('[AutoPlanner] Found', courses.length, 'courses total');
    
    if (progressCallback) {
      progressCallback({ phase: 'courses', count: courses.length, total: courses.length });
    }
    
    // Now crawl each course for assignments and instructor info
    const accessibleCourses = [];
    
    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      
      if (progressCallback) {
        progressCallback({ 
          phase: 'assignments', 
          current: i + 1, 
          total: courses.length,
          courseName: course.name 
        });
      }
      
      try {
        const crawlResult = await crawlCourseContent(course.id, course.name);
        
        // Skip inaccessible courses
        if (!crawlResult.accessible) {
          console.log(`[AutoPlanner] Skipping inaccessible course: ${course.name}`);
          continue;
        }
        
        // Update instructor if found from course page
        if (crawlResult.instructor && !course.instructor) {
          course.instructor = crawlResult.instructor;
        }
        
        // Add assignments
        results.assignments.push(...crawlResult.assignments);
        
        // Keep track of accessible courses
        accessibleCourses.push(course);
      } catch (error) {
        console.error(`[AutoPlanner] Error crawling course ${course.name}:`, error);
        results.errors.push({ course: course.name, error: error.message });
      }
      
      // Small delay between courses to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Only include accessible courses in results
    results.courses = accessibleCourses;
    
    console.log('[AutoPlanner] Sync complete:', results.courses.length, 'courses,', results.assignments.length, 'assignments,', results.errors.length, 'errors');
    
    return results;
  }

  // Extract assignments from current page only (for manual extraction)
  function extractAssignmentsFromCurrentPage() {
    const urlCourseMatch =
      window.location.href.match(/course_id=([^&]+)/) ||
      window.location.href.match(/\/ultra\/course\/([^/?]+)/);
    const currentCourseId = urlCourseMatch ? urlCourseMatch[1] : null;
    
    return extractAssignmentsFromDoc(document, currentCourseId, 'Current Course');
  }

  function detectAssignmentType(title) {
    const lower = title.toLowerCase();
    if (lower.includes('quiz')) return 'quiz';
    if (lower.includes('exam') || lower.includes('midterm') || lower.includes('final')) return 'exam';
    if (lower.includes('homework') || lower.includes('hw')) return 'homework';
    if (lower.includes('project')) return 'project';
    if (lower.includes('lab')) return 'lab';
    if (lower.includes('reading')) return 'reading';
    if (lower.includes('discussion')) return 'discussion';
    return 'assignment';
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[AutoPlanner] Received message:', request.action);
    
    if (request.action === 'ping') {
      // Simple ping to check if content script is loaded
      sendResponse({ success: true, loaded: true, url: window.location.href });
      return true;
    }
    
    if (request.action === 'extractData') {
      // Simple extraction from current page only
      const courses = extractCourses();
      const assignments = extractAssignmentsFromCurrentPage();
      console.log('[AutoPlanner] extractData: found', courses.length, 'courses,', assignments.length, 'assignments');
      
      sendResponse({
        success: true,
        data: {
          courses: courses,
          assignments: assignments,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      });
      return true;
    }
    
    if (request.action === 'fullSync') {
      console.log('[AutoPlanner] Starting fullSync...');
      // Full automatic sync - crawl all courses
      (async () => {
        try {
          const results = await fullSync((progress) => {
            console.log('[AutoPlanner] Progress:', progress);
            // Send progress updates via runtime message
            try {
              chrome.runtime.sendMessage({ 
                action: 'syncProgress', 
                progress: progress 
              });
            } catch (e) {
              // Ignore if popup closed
            }
          });
          
          console.log('[AutoPlanner] fullSync complete:', results.courses.length, 'courses,', results.assignments.length, 'assignments');
          
          sendResponse({
            success: true,
            data: {
              courses: results.courses,
              assignments: results.assignments,
              errors: results.errors,
              url: window.location.href,
              timestamp: new Date().toISOString()
            }
          });
        } catch (error) {
          console.error('[AutoPlanner] fullSync error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
    
    if (request.action === 'checkPage') {
      const info = {
        isBlackboard: isBlackboardPage(),
        isLoggedIn: isLoggedIn(),
        coursesOnPage: extractCourses().length,
        url: window.location.href
      };
      console.log('[AutoPlanner] checkPage:', info);
      sendResponse(info);
      return true;
    }
    
    return true;
  });

  // Only log and fully activate on Blackboard pages
  if (isBlackboardPage()) {
    console.log('[Assignment Auto-Planner] Content script active on Blackboard page:', window.location.href);
  } else {
    console.log('[Assignment Auto-Planner] Content script loaded but not a Blackboard page:', window.location.href);
  }
})();
