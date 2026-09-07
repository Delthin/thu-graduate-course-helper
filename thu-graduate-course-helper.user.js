// ==UserScript==
// @name         清华研究生选课报名人数
// @namespace    local.tsinghua.course-count
// @version      0.5.6
// @description  用可视化课程表选择培养计划课程、设置志愿、显示报名人数并维持登录态
// @homepageURL  https://github.com/Delthin/thu-graduate-course-helper
// @supportURL   https://github.com/Delthin/thu-graduate-course-helper/issues
// @downloadURL  https://raw.githubusercontent.com/Delthin/thu-graduate-course-helper/main/thu-graduate-course-helper.user.js
// @updateURL    https://raw.githubusercontent.com/Delthin/thu-graduate-course-helper/main/thu-graduate-course-helper.user.js
// @match        https://zhjwxk.cic.tsinghua.edu.cn/xkYjs.vxkYjsXkbBs.do*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window || !/(?:^|[?&])m=main(?:&|$)/.test(location.search)) return;

  const REFRESH_MS = 15 * 60 * 1000;
  const KEEPALIVE_MS = 3 * 60 * 1000;
  const STATS_PATH = '/xkYjs.vxkYjsXkbBs.do?m=xkqkSearch&p_xnxq=';
  const RECOMMENDATION_PATH = '/xkBks.xgpg_xspjyxkt.do?cm=xgpg_qbkcmycdzbShow&p_xnxq=';
  const TIMETABLE_OPEN_KEY = 'thu-course-helper-timetable-open';
  const DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五'];
  const SLOTS = [
    ['第1大节', '08:00–09:35'], ['第2大节', '09:50–12:15'],
    ['第3大节', '13:30–15:05'], ['第4大节', '15:20–16:55'],
    ['第5大节', '17:05–18:40'], ['第6大节', '19:20–21:45'],
  ];
  const state = {
    selectionDoc: null,
    observer: null,
    panel: null,
    cache: new Map(),
    recommendationCache: new Map(),
    cacheTerm: null,
    enrolledCache: [],
    loading: false,
    loadingRecommendations: false,
    keepingAlive: false,
    scanTimer: null,
    timetableOpen: false,
    filter: '',
    showRestricted: false,
    showAlternatives: false,
    countStatus: '准备中…',
    recommendationStatus: '推荐准备中…',
  };
  try {
    state.timetableOpen = sessionStorage.getItem(TIMETABLE_OPEN_KEY) === '1';
  } catch (_) {
    // 无存储权限时仍可在当前页面使用。
  }

  function rememberTimetableOpen(open) {
    state.timetableOpen = open;
    try {
      if (open) sessionStorage.setItem(TIMETABLE_OPEN_KEY, '1');
      else sessionStorage.removeItem(TIMETABLE_OPEN_KEY);
    } catch (_) {
      // 无存储权限时仅保留内存状态。
    }
  }

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  function allDocs(rootWindow, seen = new Set(), result = []) {
    if (!rootWindow || seen.has(rootWindow)) return result;
    seen.add(rootWindow);
    try {
      result.push(rootWindow.document);
      for (let i = 0; i < rootWindow.frames.length; i += 1) allDocs(rootWindow.frames[i], seen, result);
    } catch (_) {
      // 忽略无权访问的跨域 frame。
    }
    return result;
  }

  function findSelectionDoc() {
    return allDocs(window).find(doc => doc.querySelector('#p_kch')) || null;
  }

  function findEnrolledDoc() {
    return allDocs(window).find(doc => {
      const url = doc.location?.href || '';
      const text = clean(doc.body?.textContent || '');
      return /[?&]m=yxSearchTab(?:&|$)/.test(url)
        || (text.includes('您共选择了') && text.includes('课程号') && text.includes('课序号'));
    }) || null;
  }

  function enrolledDocReady(doc) {
    const text = clean(doc?.body?.textContent || '');
    return text.includes('您共选择了') && text.includes('课程号') && text.includes('课序号');
  }

  function getTerm(doc) {
    for (const candidate of [doc, ...allDocs(window)]) {
      try {
        const term = new URL(candidate.location.href).searchParams.get('p_xnxq');
        if (term) return term;
      } catch (_) {
        // 继续查找其他同源 frame。
      }
    }
    return '2026-2027-1';
  }

  function sessionPingUrl(term, nonce = Date.now()) {
    const url = new URL('/xkYjs.vxkYjsXkbBs.do', location.origin);
    url.searchParams.set('m', 'showTree');
    url.searchParams.set('p_xnxq', term);
    url.searchParams.set('_tm_keepalive', nonce);
    return url.href;
  }

  function sessionExpired(text) {
    return /用户登[陆录]超时|登录超时|访问内容不存在|重新登录/.test(text);
  }

  function setKeepAliveStatus(status, title) {
    const dot = state.panel?.querySelector('[data-alive]');
    if (!dot) return;
    dot.className = `tm-alive tm-alive-${status}`;
    dot.title = title;
    dot.closest('button').title = title;
  }

  async function keepSessionAlive() {
    if (!state.selectionDoc || state.keepingAlive) return;
    state.keepingAlive = true;
    try {
      const response = await fetch(sessionPingUrl(getTerm(state.selectionDoc)), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const declared = response.headers.get('content-type')?.match(/charset=([^;]+)/i)?.[1]?.trim();
      const labels = [...new Set([declared, 'gb18030', 'utf-8'].filter(Boolean))];
      const expired = labels.some(label => {
        try {
          return sessionExpired(new TextDecoder(label).decode(buffer));
        } catch (_) {
          return false;
        }
      });
      setKeepAliveStatus(expired ? 'expired' : 'ok', expired
        ? '登录已失效，请从清华信息门户重新进入选课系统'
        : `登录保活正常，最近检查 ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setKeepAliveStatus('warning', `登录保活请求失败：${error.message}`);
    } finally {
      state.keepingAlive = false;
    }
  }

  function extractCourseRows(doc) {
    const courses = [];
    const seen = new Set();
    for (const link of doc.querySelectorAll('a[id*="_kcm_a"]')) {
      const row = link.closest('tr');
      if (!row || seen.has(row)) continue;
      seen.add(row);

      const cells = [...row.cells].filter(cell => !cell.classList.contains('tm-count-cell'));
      const texts = cells.map(cell => clean(cell.textContent));
      const codeIndex = texts.findIndex(text => /^\d{8}$/.test(text));
      const section = texts[codeIndex + 1] || '';
      if (codeIndex < 0 || !/^\d+$/.test(section)) continue;

      const checkbox = row.querySelector('input[type="checkbox"]');
      const wishSelect = row.querySelector('select');
      const note = texts[codeIndex + 9] || '';
      courses.push({
        row,
        checkbox,
        wishSelect,
        code: texts[codeIndex],
        section,
        key: `${texts[codeIndex]}-${section}`,
        name: clean(link.textContent),
        remaining: Number.parseInt(texts[codeIndex + 4], 10),
        schedule: texts[codeIndex + 5] || '',
        capacity: Number.parseInt(texts[codeIndex + 6], 10),
        credits: texts[codeIndex + 7] || '',
        teacher: texts[codeIndex + 8] || '',
        note,
        selected: Boolean(checkbox?.checked),
        enrolled: false,
        unavailable: !checkbox || checkbox.disabled || clean(row.textContent).includes('不可选'),
        remote: /限[:：]?深圳|深圳学生|国际研究生院/.test(note),
      });
    }
    return courses;
  }

  function extractEnrolledRows(doc) {
    if (!doc) return [];
    const courses = [];
    for (const row of doc.querySelectorAll('tr')) {
      const texts = [...row.cells].map(cell => clean(cell.textContent));
      const codeIndex = texts.findIndex(text => /^\d{8}$/.test(text));
      const section = texts[codeIndex + 1] || '';
      if (codeIndex < 0 || !/^\d+$/.test(section)) continue;
      courses.push({
        row,
        checkbox: null,
        wishSelect: null,
        wishLabel: texts[codeIndex - 1] || '',
        code: texts[codeIndex],
        section,
        key: `${texts[codeIndex]}-${section}`,
        name: texts[codeIndex + 2] || '',
        remaining: Number.NaN,
        schedule: texts[codeIndex + 4] || '',
        capacity: Number.NaN,
        credits: texts[codeIndex + 3] || '',
        teacher: texts[codeIndex + 5] || '',
        note: '',
        selected: false,
        enrolled: true,
        unavailable: false,
        remote: false,
      });
    }
    return courses;
  }

  function mergeCourseRows(doc, enrolledDoc = findEnrolledDoc()) {
    if (enrolledDocReady(enrolledDoc)) {
      state.enrolledCache = extractEnrolledRows(enrolledDoc).map(course => ({ ...course, row: null }));
    }
    const courses = new Map(extractCourseRows(doc).map(course => [course.key, course]));
    for (const course of state.enrolledCache) courses.set(course.key, course);
    return [...courses.values()];
  }

  function parseSchedule(schedule) {
    const result = [];
    const seen = new Set();
    const pattern = /([1-7])-([1-6])\(([^)]*)\)/g;
    let match;
    while ((match = pattern.exec(schedule))) {
      const day = Number(match[1]);
      const slot = Number(match[2]);
      const key = `${day}-${slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ day, slot, weeks: clean(match[3]) });
    }
    return result;
  }

  function weekSet(label) {
    const text = clean(label);
    if (!text || text.includes('全周')) return null;
    const weeks = new Set();
    if (text.includes('前八周')) {
      for (let week = 1; week <= 8; week += 1) weeks.add(week);
    } else if (text.includes('后八周')) {
      for (let week = 9; week <= 16; week += 1) weeks.add(week);
    } else {
      for (const match of text.matchAll(/(\d+)(?:\s*[-—~至]\s*(\d+))?/g)) {
        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        for (let week = start; week <= end; week += 1) weeks.add(week);
      }
    }
    if (text.includes('单周')) for (const week of [...weeks]) if (week % 2 === 0) weeks.delete(week);
    if (text.includes('双周')) for (const week of [...weeks]) if (week % 2 === 1) weeks.delete(week);
    return weeks.size ? weeks : null;
  }

  function weeksOverlap(left, right) {
    const a = weekSet(left);
    const b = weekSet(right);
    return !a || !b || [...a].some(week => b.has(week));
  }

  function markConflicts(courses) {
    const occupied = courses.filter(course => course.enrolled).flatMap(course => parseSchedule(course.schedule));
    return courses.map(course => ({
      ...course,
      conflict: !course.enrolled && parseSchedule(course.schedule).some(occurrence => occupied.some(enrolled =>
        occurrence.day === enrolled.day && occurrence.slot === enrolled.slot && weeksOverlap(occurrence.weeks, enrolled.weeks),
      )),
    }));
  }

  function injectStyle(doc) {
    if (doc.getElementById('tm-course-helper-style')) return;
    const style = doc.createElement('style');
    style.id = 'tm-course-helper-style';
    style.textContent = `
      #tm-helper-panel { position:fixed;z-index:2147483646;top:8px;right:8px;display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid #d8d8d8;border-radius:5px;background:rgba(255,255,255,.97);box-shadow:0 1px 7px rgba(0,0,0,.18);color:#555;font:12px/1.35 Arial,'Microsoft YaHei',sans-serif; }
      #tm-helper-panel button,#tm-timetable button { padding:4px 8px;border:1px solid #bbb;border-radius:4px;background:#fff;color:#444;cursor:pointer; }
      #tm-helper-panel button:hover,#tm-timetable button:hover { background:#f1f3f5; }
      #tm-helper-panel button:disabled { cursor:wait;opacity:.6; }
      .tm-alive { margin-left:3px;font-size:9px; }.tm-alive-wait { color:#999; }.tm-alive-ok { color:#2d9348; }.tm-alive-warning { color:#d98400; }.tm-alive-expired { color:#c62828; }
      #tm-timetable { position:fixed;z-index:2147483647;inset:0;display:none;flex-direction:column;background:#f4f5f7;color:#30343b;font:12px/1.3 Arial,'Microsoft YaHei',sans-serif; }
      #tm-timetable.tm-open { display:flex; }
      .tm-tt-head { display:flex;align-items:center;gap:7px;min-height:36px;padding:5px 8px;border-bottom:1px solid #d8dce2;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08); }
      .tm-tt-head strong { margin-right:4px;font-size:16px;white-space:nowrap; }.tm-tt-head [data-selection] { margin-right:auto;color:#555;white-space:nowrap; }
      .tm-tt-head input[type="search"] { width:180px;padding:4px 7px;border:1px solid #bbb;border-radius:4px; }.tm-tt-head label { white-space:nowrap; }
      .tm-tt-body { flex:1;overflow:auto;padding:5px; }
      .tm-grid { display:grid;grid-template-columns:68px repeat(5,minmax(174px,1fr));min-width:940px;border:1px solid #d8dce2;border-radius:5px;overflow:hidden;background:#fff; }
      .tm-grid-head,.tm-time,.tm-slot { border-right:1px solid #e1e4e8;border-bottom:1px solid #e1e4e8; }
      .tm-grid-head { position:sticky;top:0;z-index:2;padding:6px;background:#e9edf2;text-align:center;font-weight:700; }
      .tm-time { padding:7px 3px;background:#f6f7f9;text-align:center;font-weight:700; }.tm-time small { display:block;margin-top:2px;color:#777;font-size:10px;font-weight:400; }
      .tm-slot { min-height:54px;padding:2px;background:#fff;display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:2px;align-content:start; }
      .tm-card { position:relative;padding:3px 4px;border-left:3px solid var(--tm-color);border-radius:3px;background:color-mix(in srgb,var(--tm-color) 10%,white);box-shadow:0 1px 2px rgba(0,0,0,.08);font-size:11px;line-height:1.2; }
      .tm-card.tm-selected { background:#e4f5e9;outline:2px solid #2d9348; }.tm-card.tm-enrolled { background:#e8f1fb;outline:2px solid #4879ad; }.tm-card.tm-conflict { background:#eceff2;filter:grayscale(.8);opacity:.5; }.tm-card.tm-over { box-shadow:inset 0 0 0 2px rgba(198,40,40,.35); }
      .tm-card-head { display:flex;align-items:flex-start;gap:3px; }.tm-card-head label { display:flex;align-items:flex-start;gap:3px;min-width:0;flex:1;cursor:pointer; }.tm-card.tm-enrolled .tm-card-head label,.tm-card.tm-conflict .tm-card-head label { cursor:default; }
      .tm-card-head input { margin:1px 0 0;flex:0 0 auto; }.tm-card-title { overflow:hidden;font-size:12px;font-weight:700;white-space:nowrap;text-overflow:ellipsis; }.tm-card-state { flex:0 0 auto;padding:1px 4px;border-radius:3px;background:#4879ad;color:#fff;font-size:9px; }.tm-conflict-note { color:#8a3333;font-weight:700; }
      .tm-card select { max-width:76px;height:20px;padding:0;border:1px solid #aaa;border-radius:3px;background:#fff;font-size:10px; }
      .tm-meta { margin-top:2px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }.tm-note { color:#76520d; }.tm-count { font-weight:700; }.tm-count.tm-count-high { color:#c62828; }.tm-count.tm-count-mid { color:#a96200; }.tm-count.tm-count-low { color:#248a3d; }
      .tm-wish-line { white-space:normal;overflow:visible;text-overflow:clip; }.tm-probability { font-weight:700; }.tm-probability-full { color:#248a3d; }.tm-probability-partial { color:#a96200; }.tm-probability-zero { color:#c62828; }.tm-recommendation { color:#5d3d9b;white-space:normal;overflow:visible;text-overflow:clip; }.tm-recommendation strong { color:#2d9348; }
      .tm-unparsed { margin-top:5px;padding:7px;border:1px solid #ddd;border-radius:5px;background:#fff; }.tm-unparsed summary { cursor:pointer;font-weight:700; }.tm-unparsed p { margin:4px 0; }
      .tm-empty { grid-column:1/-1;color:#bbb;text-align:center;padding:17px 0; }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function prepareCacheTerm(term) {
    if (state.cacheTerm && state.cacheTerm !== term) {
      state.cache.clear();
      state.recommendationCache.clear();
      state.enrolledCache = [];
      state.countStatus = '准备中…';
    }
    state.cacheTerm = term;
  }

  function cacheStats(code, value) {
    state.cache.set(code, value);
  }

  function getRecord(course) {
    const cached = state.cache.get(course.code);
    return cached?.sections?.get(course.section) || (cached?.error || cached?.empty ? cached : null);
  }

  function parseWishCounts(value) {
    const text = clean(value);
    const priority = Number.parseInt(text.match(/(?:\(|（)\s*(\d+)\s*(?:\)|）)/)?.[1] || '0', 10);
    const counts = text.replace(/\(\s*\d+\s*\)|（\s*\d+\s*）/g, '').match(/\d+/g) || [];
    return {
      priority,
      first: Number.parseInt(counts[0] || '0', 10),
      second: Number.parseInt(counts[1] || '0', 10),
      third: Number.parseInt(counts[2] || '0', 10),
    };
  }

  function wishBreakdown(record) {
    const degree = parseWishCounts(record?.degree);
    const nonDegree = parseWishCounts(record?.nonDegree);
    return {
      priority: degree.priority + nonDegree.priority,
      first: degree.first + nonDegree.first,
      second: degree.second + nonDegree.second,
      third: degree.third + nonDegree.third,
    };
  }

  function wishProbabilities(record) {
    const capacity = Number(record?.capacity);
    if (!Number.isFinite(capacity) || capacity < 0) return null;
    const wishes = wishBreakdown(record);
    const chance = (higher, same) => {
      const remaining = capacity - higher;
      const applicants = same + 1;
      if (remaining <= 0) return 0;
      if (remaining >= applicants) return 100;
      return Math.max(1, Math.min(99, Math.round(remaining / applicants * 100)));
    };
    return {
      first: chance(wishes.priority, wishes.first),
      second: chance(wishes.priority + wishes.first, wishes.second),
      third: chance(wishes.priority + wishes.first + wishes.second, wishes.third),
    };
  }

  function probabilityHtml(label, count, probability) {
    const level = probability === 100 ? 'full' : probability === 0 ? 'zero' : 'partial';
    return `${label}${count}（<span class="tm-probability tm-probability-${level}">${probability}%</span>）`;
  }

  function countInfo(course) {
    const record = getRecord(course);
    if (record?.error) return { text: '总—', detail: record.error, level: 'error' };
    if (record?.empty) return { text: `总—/${course.capacity || '?'}`, detail: '暂无统计', level: 'error' };
    if (!Number.isFinite(record?.total) || !Number.isFinite(record?.capacity)) {
      return { text: `总—/${course.capacity || '?'}`, detail: '人数加载中', level: 'error' };
    }
    const ratio = record.capacity > 0 ? record.total / record.capacity : 0;
    const wishes = wishBreakdown(record);
    const probabilities = wishProbabilities(record);
    const parts = [
      ['一', wishes.first, probabilities.first],
      ['二', wishes.second, probabilities.second],
      ['三', wishes.third, probabilities.third],
    ];
    if (wishes.priority) parts.push(['优', wishes.priority, 100]);
    return {
      text: `总${record.total}/${record.capacity}`,
      detail: parts.map(([label, count, probability]) => `${label}${count}（${probability}%）`).join(' · '),
      detailHtml: parts.map(part => probabilityHtml(...part)).join(' · '),
      rule: '按当前人数估算并将你计为新增1人；同一志愿按等概率竞争。实际规则与后续人数变化可能影响结果',
      level: ratio >= 1 ? 'high' : ratio >= 0.8 ? 'mid' : 'low',
      ratio,
      wishes,
      probabilities,
    };
  }

  function recommendationKey(course) {
    return `course:${course.name}`;
  }

  function teacherRecommendationKey(teacher) {
    return `teacher:${teacher}`;
  }

  function parseRecommendationTable(doc) {
    const rows = [...doc.querySelectorAll('tr')];
    const required = ['教师名', '课程号', '课程名', '分数1', '分数2', '分数3', '分数4', '分数5', '分数6', '分数7'];
    const header = rows.find(row => {
      const cells = [...row.cells].map(cell => clean(cell.textContent));
      return cells.length >= required.length + 1 && required.every(title => cells.some(text => text.includes(title)));
    });
    if (!header) return [];
    const headers = [...header.cells].map(cell => clean(cell.textContent));
    const index = title => headers.findIndex(text => text.includes(title));
    const indexes = { department: index('开课院系'), teacher: index('教师名'), code: index('课程号'), name: index('课程名') };
    const scores = [1, 2, 3, 4, 5, 6, 7].map(score => index(`分数${score}`));
    if ([indexes.department, indexes.teacher, indexes.code, indexes.name, ...scores].some(value => value < 0)) return [];
    return rows.flatMap(row => {
      const cells = [...row.cells].map(cell => clean(cell.textContent));
      const counts = scores.map(position => Number.parseInt(cells[position], 10));
      if (!cells[indexes.teacher] || counts.some(value => !Number.isFinite(value))) return [];
      return [{ department: cells[indexes.department], teacher: cells[indexes.teacher], code: cells[indexes.code], name: cells[indexes.name], counts }];
    });
  }

  function recommendationMetrics(records) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const record of records) record.counts.forEach((value, index) => { counts[index] += value; });
    const total = counts.reduce((sum, value) => sum + value, 0);
    if (!total) return null;
    const mean = counts.reduce((sum, value, index) => sum + value * (index + 1), 0) / total;
    return {
      total,
      strictRate: counts[6] / total * 100,
      rate: (counts[5] + counts[6]) / total * 100,
      value: (mean - 1) / 6 * 100,
    };
  }

  function normalizeCourseName(value) {
    return clean(value).replace(/[\s\-—_（）()《》【】、，,.。]/g, '');
  }

  function recommendationInfo(course) {
    let cached = state.recommendationCache.get(recommendationKey(course));
    if (!cached) return null;
    if (cached.error) return { text: '历史推荐查询失败', detail: cached.error };
    let source = 'course';
    let teacherRows = course.teacher ? cached.records.filter(record => record.teacher === course.teacher) : cached.records;
    if (course.teacher && !teacherRows.length) {
      const teacherCached = state.recommendationCache.get(teacherRecommendationKey(course.teacher));
      if (!teacherCached) return null;
      cached = teacherCached;
      source = 'teacher';
      teacherRows = cached.records.filter(record => record.teacher === course.teacher);
    }
    if (cached.error) return { text: '历史推荐查询失败', detail: cached.error };
    const codeRows = teacherRows.filter(record => record.code === course.code);
    const name = normalizeCourseName(course.name);
    const nameRows = teacherRows.filter(record => name && normalizeCourseName(record.name) === name);
    const rows = codeRows.length ? codeRows : nameRows.length ? nameRows : teacherRows;
    const metrics = recommendationMetrics(rows);
    if (!metrics) return { text: '暂无历史推荐', detail: '未找到可用的上一学年评教统计' };
    const departments = new Set(rows.map(record => record.department).filter(Boolean));
    const scope = source === 'teacher' ? '教师历史' : codeRows.length ? (departments.size > 1 ? '同课程跨院系' : '同课程') : '同名课';
    return {
      text: `${scope}推荐 ${metrics.rate.toFixed(1)}%（${metrics.value.toFixed(1)}分，${metrics.total}人）`,
      detail: `6-7分推荐率 ${metrics.rate.toFixed(1)}%；7分强推荐率 ${metrics.strictRate.toFixed(1)}%；加权推荐值 ${metrics.value.toFixed(1)}/100；样本 ${metrics.total} 人${departments.size > 1 ? `；合并 ${[...departments].join('、')}` : ''}`,
    };
  }

  function createDataFrame(src, title) {
    const hostDoc = state.selectionDoc || document;
    const frame = hostDoc.createElement('iframe');
    frame.title = title;
    frame.src = src;
    frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1000px;height:800px;border:0;pointer-events:none;';
    hostDoc.body.appendChild(frame);
    return frame;
  }

  function findRecommendationDoc(frameWindow) {
    return allDocs(frameWindow).find(doc => {
      const text = clean(doc.body?.textContent || '');
      return text.includes('选课学生推荐度') && text.includes('分数7');
    }) || null;
  }

  function recommendationResponseSignature(doc) {
    return [...doc.querySelectorAll('tr')].map(row => clean(row.textContent)).join('|');
  }

  function setInputValue(input, value) {
    input.value = value;
    const EventCtor = input.ownerDocument.defaultView?.Event || Event;
    input.dispatchEvent(new EventCtor('input', { bubbles: true }));
    input.dispatchEvent(new EventCtor('change', { bubbles: true }));
  }

  async function queryRecommendation(frame, filter) {
    const recommendationDoc = findRecommendationDoc(frame.contentWindow);
    if (!recommendationDoc) throw new Error('历史推荐页未加载');
    const inputs = visibleTextInputs(recommendationDoc).slice(0, 3);
    const button = [...recommendationDoc.querySelectorAll('button,input')].find(element => clean(element.textContent || element.value) === '查询');
    if (inputs.length < 3 || !button) throw new Error('无法识别历史推荐查询控件');
    const before = recommendationResponseSignature(recommendationDoc);
    setInputValue(inputs[0], filter.teacher || '');
    setInputValue(inputs[1], '');
    setInputValue(inputs[2], filter.name || '');
    button.click();
    const result = await waitFor(() => {
      const currentDoc = findRecommendationDoc(frame.contentWindow);
      if (!currentDoc) return null;
      const text = clean(currentDoc.body?.textContent || '');
      if (sessionExpired(text)) return { error: '登录状态失效' };
      const changed = recommendationResponseSignature(currentDoc) !== before;
      const rows = parseRecommendationTable(currentDoc);
      if (changed && (rows.length || /Displaying\s+0|没有记录/.test(text))) return { rows };
      return null;
    }, 20000);
    if (!result) throw new Error('历史推荐查询超时');
    if (result.error) throw new Error(result.error);
    return result.rows;
  }

  async function refreshRecommendations(doc, courses) {
    if (state.loadingRecommendations) return;
    const courseCandidates = [...new Map(courses.filter(course => course.name).map(course => [recommendationKey(course), course])).entries()]
      .filter(([key]) => !state.recommendationCache.has(key));
    const needsTeacherFallback = courses.some(course => {
      const cached = state.recommendationCache.get(recommendationKey(course));
      return course.teacher && cached && !cached.records?.some(record => record.teacher === course.teacher)
        && !state.recommendationCache.has(teacherRecommendationKey(course.teacher));
    });
    if (!courseCandidates.length && !needsTeacherFallback) return;

    state.loadingRecommendations = true;
    const term = getTerm(doc);
    const frame = createDataFrame(`${location.origin}${RECOMMENDATION_PATH}${encodeURIComponent(term)}&p_xslb=yjs`, '历史推荐数据');
    let finalStatus = '推荐查询完成';
    try {
      setRecommendationPanel(`推荐 0/${courseCandidates.length}…`);
      if (!await waitFor(() => findRecommendationDoc(frame.contentWindow))) throw new Error('历史推荐页未加载');

      let done = 0;
      for (const [key, course] of courseCandidates) {
        try {
          state.recommendationCache.set(key, { records: await queryRecommendation(frame, { name: course.name }) });
        } catch (error) {
          state.recommendationCache.set(key, { error: error.message, records: [] });
        }
        done += 1;
        setRecommendationPanel(`推荐 ${done}/${courseCandidates.length}…`);
        invalidateTimetable(doc);
        if (state.timetableOpen) renderTimetable(doc);
      }

      const teacherCandidates = [...new Map(courses.filter(course => {
        if (!course.teacher) return false;
        const cached = state.recommendationCache.get(recommendationKey(course));
        return !cached?.records?.some(record => record.teacher === course.teacher)
          && !state.recommendationCache.has(teacherRecommendationKey(course.teacher));
      }).map(course => [teacherRecommendationKey(course.teacher), course.teacher])).entries()];
      done = 0;
      for (const [key, teacher] of teacherCandidates) {
        setRecommendationPanel(`改名回查 ${done}/${teacherCandidates.length}…`);
        try {
          state.recommendationCache.set(key, { records: await queryRecommendation(frame, { teacher }) });
        } catch (error) {
          state.recommendationCache.set(key, { error: error.message, records: [] });
        }
        done += 1;
        invalidateTimetable(doc);
        if (state.timetableOpen) renderTimetable(doc);
      }

      const results = courses.map(course => recommendationInfo(course));
      const found = results.filter(result => result && !/暂无|失败/.test(result.text)).length;
      const missing = results.filter(result => result?.text.includes('暂无')).length;
      const errors = [...state.recommendationCache.values()].filter(result => result.error);
      finalStatus = `推荐 ${found}/${courses.length}${missing ? ` · 无${missing}` : ''}${errors.length ? ` · 失败${errors.length}:${errors[0].error}` : ''}`;
    } catch (error) {
      finalStatus = `推荐查询失败：${error.message}`;
    } finally {
      frame.remove();
      state.loadingRecommendations = false;
      setRecommendationPanel(finalStatus);
    }
  }

  function updateRefreshButton() {
    const button = state.selectionDoc?.querySelector('#tm-timetable [data-refresh]');
    if (button) button.disabled = state.loading || state.loadingRecommendations;
  }

  function setRecommendationPanel(status) {
    state.recommendationStatus = status;
    const modal = state.selectionDoc?.getElementById('tm-timetable');
    if (modal) modal.querySelector('[data-recommendation-status]').textContent = status;
    updateRefreshButton();
  }

  function setPanel(status) {
    state.countStatus = status;
    const modal = state.selectionDoc?.getElementById('tm-timetable');
    if (modal) modal.querySelector('[data-status]').textContent = status;
    updateRefreshButton();
  }

  function findStatsDoc(frameWindow) {
    return allDocs(frameWindow).find(doc => {
      const text = clean(doc.body?.textContent || '');
      return text.includes('报名总人数') && text.includes('学位课报名人数');
    }) || null;
  }

  async function waitFor(getValue, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = getValue();
      if (value) return value;
      await sleep(180);
    }
    return null;
  }

  function parseStatsTable(doc, code) {
    const rows = [...doc.querySelectorAll('tr')];
    const required = ['课程号', '课序号', '可选容量', '报名总人数', '学位课报名人数', '非学位课报名人数'];
    const header = rows.find(row => {
      const cells = [...row.cells].map(cell => clean(cell.textContent));
      return cells.length >= required.length && required.every(title => cells.some(text => text.includes(title)));
    });
    if (!header) return { sections: new Map(), updatedAt: '' };

    const headers = [...header.cells].map(cell => clean(cell.textContent));
    const index = title => headers.findIndex(text => text.includes(title));
    const indexes = {
      code: index('课程号'), section: index('课序号'), capacity: index('可选容量'),
      total: index('报名总人数'), degree: index('学位课报名人数'), nonDegree: index('非学位课报名人数'),
    };
    const sections = new Map();
    for (const row of rows) {
      const cells = [...row.cells].map(cell => clean(cell.textContent));
      if (indexes.code < 0 || cells[indexes.code] !== code) continue;
      const section = cells[indexes.section] || '';
      if (!/^\d+$/.test(section)) continue;
      sections.set(section, {
        capacity: Number.parseInt(cells[indexes.capacity], 10), total: Number.parseInt(cells[indexes.total], 10),
        degree: cells[indexes.degree] || '', nonDegree: cells[indexes.nonDegree] || '',
      });
    }
    const pageText = clean(doc.body?.textContent || '');
    const updatedAt = pageText.match(/填报志愿统计时间：\s*([0-9]{4}年\S+)/)?.[1] || '';
    return { sections, updatedAt };
  }

  function visibleTextInputs(doc) {
    return [...doc.querySelectorAll('input')].filter(input =>
      !['hidden', 'button', 'submit', 'reset'].includes((input.type || 'text').toLowerCase()),
    );
  }

  function statsResponseSignature(doc) {
    const rows = [...doc.querySelectorAll('tr')].map(row => clean(row.textContent)).join('|');
    return `${rows}|${clean(doc.body?.textContent || '').includes('没有记录')}`;
  }

  function mergeStatsResults(left, right) {
    const merged = { sections: new Map(left.sections), updatedAt: left.updatedAt || right.updatedAt };
    for (const [section, record] of right.sections) merged.sections.set(section, record);
    return merged;
  }

  function nextStatsPage(doc) {
    return [...doc.querySelectorAll('a')].find(link =>
      clean(link.textContent) === '下一页' && /javascript:\s*turn\(\d+\)/i.test(link.getAttribute('href') || ''),
    ) || null;
  }

  async function collectStatsPages(frame, code, firstResult) {
    let result = firstResult;
    let currentDoc = findStatsDoc(frame.contentWindow);
    let signature = currentDoc ? statsResponseSignature(currentDoc) : '';
    const seen = new Set([signature]);
    for (let page = 1; currentDoc && page < 20; page += 1) {
      const next = nextStatsPage(currentDoc);
      if (!next) break;
      next.click();
      const nextDoc = await waitFor(() => {
        const doc = findStatsDoc(frame.contentWindow);
        const nextSignature = doc ? statsResponseSignature(doc) : '';
        return doc && nextSignature !== signature && !seen.has(nextSignature) ? doc : null;
      }, 10000);
      if (!nextDoc) break;
      currentDoc = nextDoc;
      signature = statsResponseSignature(currentDoc);
      seen.add(signature);
      result = mergeStatsResults(result, parseStatsTable(currentDoc, code));
    }
    return result;
  }

  async function queryCode(frame, code) {
    const statsDoc = findStatsDoc(frame.contentWindow);
    if (!statsDoc) throw new Error('统计页未加载');

    const input = visibleTextInputs(statsDoc)[0];
    const button = [...statsDoc.querySelectorAll('button,input')].find(element => clean(element.textContent || element.value) === '查询');
    if (!input || !button) throw new Error('无法识别统计查询控件');

    const beforeDoc = statsDoc;
    const beforeSignature = statsResponseSignature(statsDoc);
    setInputValue(input, code);
    button.click();

    const result = await waitFor(() => {
      const currentDoc = findStatsDoc(frame.contentWindow);
      const anyDoc = allDocs(frame.contentWindow).find(doc => doc.body);
      const pageText = clean(anyDoc?.body?.textContent || '');
      if (/用户登录.*不存在|登录超时|重新登录/.test(pageText)) return { error: '登录状态失效' };
      if (!currentDoc) return null;
      if (currentDoc === beforeDoc && statsResponseSignature(currentDoc) === beforeSignature) return null;

      const parsed = parseStatsTable(currentDoc, code);
      if (parsed.sections.size) return parsed;
      if (clean(visibleTextInputs(currentDoc)[0]?.value) === code || clean(currentDoc.body?.textContent).includes('没有记录')) {
        return { ...parsed, empty: true };
      }
      return null;
    }, 20000);

    if (!result) throw new Error('统计查询超时');
    if (result.error) throw new Error(result.error);
    return result.sections.size ? collectStatsPages(frame, code, result) : result;
  }

  async function refreshCounts(doc, codes) {
    if (state.loading || !codes.length) return;
    state.loading = true;
    const term = getTerm(doc);
    const frame = createDataFrame(`${location.origin}${STATS_PATH}${encodeURIComponent(term)}`, '报名统计数据');
    let finalStatus = '人数查询完成';
    try {
      setPanel(`人数 0/${codes.length}…`);
      if (!await waitFor(() => findStatsDoc(frame.contentWindow))) throw new Error('统计页未加载');

      let done = 0;
      let updatedAt = '';
      for (const code of codes) {
        try {
          const result = await queryCode(frame, code);
          cacheStats(code, { sections: result.sections, empty: result.empty });
          updatedAt ||= result.updatedAt;
        } catch (error) {
          cacheStats(code, { error: error.message, sections: new Map() });
        }
        done += 1;
        setPanel(`人数 ${done}/${codes.length}…`);
        invalidateTimetable(doc);
        if (state.timetableOpen) renderTimetable(doc);
      }
      finalStatus = updatedAt ? `统计至 ${updatedAt}` : '人数查询完成';
    } catch (error) {
      finalStatus = `人数查询失败：${error.message}`;
    } finally {
      frame.remove();
      state.loading = false;
      setPanel(finalStatus);
    }
  }

  function colorFor(text) {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 58% 43%)`;
  }

  function wishOptions(course) {
    if (!course.wishSelect) return '';
    return [...course.wishSelect.options].map(option =>
      `<option value="${escapeHtml(option.value)}" ${option.selected ? 'selected' : ''}>${escapeHtml(clean(option.textContent))}</option>`,
    ).join('');
  }

  function cardHtml(course, occurrence) {
    const count = countInfo(course);
    const recommendation = recommendationInfo(course);
    const disabled = course.unavailable || course.conflict ? 'disabled' : '';
    const status = course.enrolled ? '已选定' : course.conflict ? '与已选定课程时间冲突' : '';
    const title = [status, course.schedule, course.note, count.detail, count.rule].filter(Boolean).join('\n');
    return `<div class="tm-card ${course.selected ? 'tm-selected' : ''} ${course.enrolled ? 'tm-enrolled' : ''} ${course.conflict ? 'tm-conflict' : ''} ${count.level === 'high' ? 'tm-over' : ''}" data-key="${course.key}" style="--tm-color:${colorFor(course.name)}" title="${escapeHtml(title)}">
      <div class="tm-card-head">
        <label>${course.enrolled ? '<span class="tm-card-state">已选定</span>' : `<input data-pick type="checkbox" ${course.selected ? 'checked' : ''} ${disabled}`}><span class="tm-card-title">${escapeHtml(course.name)}</span></label>
        ${!course.enrolled && course.wishSelect ? `<select data-wish ${disabled}>${wishOptions(course)}</select>` : ''}
      </div>
      <div class="tm-meta">${course.code}-${course.section} · ${escapeHtml(occurrence.weeks)} · ${escapeHtml(course.teacher || '教师未定')}</div>
      ${course.note ? `<div class="tm-meta tm-note">${escapeHtml(course.note)}</div>` : ''}
      ${course.enrolled && course.wishLabel ? `<div class="tm-meta">${escapeHtml(course.wishLabel)}</div>` : ''}
      ${course.conflict ? '<div class="tm-meta tm-conflict-note">与已选定课程冲突，不可选</div>' : ''}
      <div class="tm-meta">${escapeHtml(course.credits)}学分 · <span class="tm-count tm-count-${count.level}">${escapeHtml(count.text)}</span></div>
      <div class="tm-meta tm-wish-line">${count.detailHtml || escapeHtml(count.detail)}</div>
      ${recommendation ? `<div class="tm-meta tm-recommendation" title="${escapeHtml(recommendation.detail)}">${escapeHtml(recommendation.text)}</div>` : ''}
    </div>`;
  }

  function selectedCourses(doc) {
    return extractCourseRows(doc).filter(course => course.selected);
  }

  function selectionSummary(doc) {
    const all = mergeCourseRows(doc);
    const selected = all.filter(course => course.selected);
    const enrolled = all.filter(course => course.enrolled);
    const credits = selected.reduce((sum, course) => sum + (Number.parseFloat(course.credits) || 0), 0);
    const wishes = { 第一志愿: 0, 第二志愿: 0, 第三志愿: 0 };
    for (const course of selected) {
      const label = clean(course.wishSelect?.selectedOptions?.[0]?.textContent);
      if (label in wishes) wishes[label] += 1;
    }
    return `已选定 ${enrolled.length} 门 · 待提交 ${selected.length} 门 / ${credits} 学分 · 一志愿 ${wishes.第一志愿}/1 · 二志愿 ${wishes.第二志愿}/2 · 三志愿 ${wishes.第三志愿}`;
  }

  function timetableCourses(doc) {
    const showRestricted = state.showRestricted;
    const showAlternatives = state.showAlternatives;
    const query = state.filter.toLowerCase();
    const all = markConflicts(mergeCourseRows(doc));
    const selectedByCode = new Map(all.filter(course => course.selected || course.enrolled).map(course => [course.code, course.section]));
    return all.filter(course => {
      if (!showRestricted && !course.enrolled && (course.unavailable || course.remote)) return false;
      if (!showAlternatives && selectedByCode.has(course.code) && selectedByCode.get(course.code) !== course.section) return false;
      return !query || `${course.name} ${course.code} ${course.section} ${course.teacher} ${course.note}`.toLowerCase().includes(query);
    });
  }

  function invalidateTimetable(doc) {
    const modal = doc.getElementById('tm-timetable');
    if (modal) delete modal.dataset.signature;
  }

  function renderTimetable(doc) {
    const modal = doc.getElementById('tm-timetable');
    if (!modal) return;
    const courses = timetableCourses(doc);
    const signature = courses.map(course => {
      const info = countInfo(course);
      const recommendation = recommendationInfo(course);
      return `${course.key}-${course.schedule}-${course.note}-${course.selected}-${course.enrolled}-${course.conflict}-${course.wishSelect?.value}-${info.text}-${info.detail}-${recommendation?.text || ''}`;
    }).join('|') + `|${modal.querySelector('[data-filter]')?.value}|${modal.querySelector('[data-restricted]')?.checked}|${modal.querySelector('[data-alternatives]')?.checked}`;
    if (modal.dataset.signature === signature) return;
    modal.dataset.signature = signature;

    const cells = new Map();
    const unparsed = [];
    for (const course of courses) {
      const occurrences = parseSchedule(course.schedule);
      if (!occurrences.length) {
        unparsed.push(course);
        continue;
      }
      for (const occurrence of occurrences) {
        if (occurrence.day < 1 || occurrence.day > 5) {
          unparsed.push(course);
          continue;
        }
        const key = `${occurrence.day}-${occurrence.slot}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ course, occurrence });
      }
    }

    const html = ['<div class="tm-grid"><div class="tm-grid-head">时间</div>'];
    for (const day of DAYS) html.push(`<div class="tm-grid-head">${day}</div>`);
    for (let slot = 1; slot <= 6; slot += 1) {
      html.push(`<div class="tm-time">${SLOTS[slot - 1][0]}<small>${SLOTS[slot - 1][1]}</small></div>`);
      for (let day = 1; day <= 5; day += 1) {
        const cards = cells.get(`${day}-${slot}`) || [];
        html.push(`<div class="tm-slot">${cards.length ? cards.map(({ course, occurrence }) => cardHtml(course, occurrence)).join('') : '<div class="tm-empty">—</div>'}</div>`);
      }
    }
    html.push('</div>');
    if (unparsed.length) {
      html.push(`<details class="tm-unparsed"><summary>其他/无法解析时间（${unparsed.length}）</summary>${unparsed.map(course => `<p><b>${escapeHtml(course.name)}</b> ${course.key}：${escapeHtml(course.schedule || '未公布')}</p>`).join('')}</details>`);
    }
    modal.querySelector('[data-grid]').innerHTML = html.join('');
    modal.querySelector('[data-count]').textContent = `${courses.length} 个课序号`;
    modal.querySelector('[data-selection]').textContent = selectionSummary(doc);
  }

  function setCourseChecked(doc, key, checked) {
    const courses = markConflicts(mergeCourseRows(doc));
    const target = courses.find(course => course.key === key);
    if (!target || target.unavailable || target.enrolled || target.conflict) return;
    if (checked) {
      for (const sibling of courses) {
        if (sibling.code === target.code && sibling.key !== target.key && sibling.checkbox?.checked) sibling.checkbox.click();
      }
    }
    if (target.checkbox.checked !== checked) target.checkbox.click();
    invalidateTimetable(doc);
    renderTimetable(doc);
  }

  function setCourseWish(doc, key, value) {
    const course = markConflicts(mergeCourseRows(doc)).find(item => item.key === key);
    if (!course?.wishSelect || course.enrolled || course.conflict) return;
    course.wishSelect.value = value;
    const EventCtor = doc.defaultView?.Event || Event;
    course.wishSelect.dispatchEvent(new EventCtor('change', { bubbles: true }));
    invalidateTimetable(doc);
    renderTimetable(doc);
  }

  function clearPlannedSelection(doc) {
    for (const course of selectedCourses(doc)) course.checkbox?.click();
    invalidateTimetable(doc);
    renderTimetable(doc);
  }

  function submitPlannedSelection(doc) {
    const selected = selectedCourses(doc);
    if (!selected.length) return doc.defaultView.alert('请先在课程表中勾选课程。');
    const form = doc.querySelector('#p_kch')?.form;
    const root = form || doc;
    const button = [...root.querySelectorAll('button,input')].find(element => clean(element.textContent || element.value) === '提交');
    if (!button) return doc.defaultView.alert('没有找到原选课页面的提交按钮。');
    if (doc.defaultView.confirm(`确认提交 ${selected.length} 门课程的选课志愿吗？`)) {
      rememberTimetableOpen(true);
      button.click();
    }
  }

  function ensureTimetable(doc) {
    let modal = doc.getElementById('tm-timetable');
    if (modal) return modal;
    modal = doc.createElement('div');
    modal.id = 'tm-timetable';
    modal.innerHTML = `<div class="tm-tt-head">
      <strong>选课方案课程表</strong><span data-count></span><span data-status></span><span data-recommendation-status></span><span data-selection></span>
      <input data-filter type="search" placeholder="筛课程/教师/课程号">
      <label><input data-alternatives type="checkbox"> 显示同课备选</label>
      <label><input data-restricted type="checkbox"> 显示不可选/深圳班</label>
      <button data-refresh type="button">刷新数据</button><button data-clear type="button">清空勾选</button><button data-submit type="button">提交所选</button><button data-close type="button">关闭</button>
    </div><div class="tm-tt-body" data-grid></div>`;
    doc.body.appendChild(modal);
    modal.querySelector('[data-filter]').value = state.filter;
    modal.querySelector('[data-restricted]').checked = state.showRestricted;
    modal.querySelector('[data-alternatives]').checked = state.showAlternatives;

    modal.querySelector('[data-close]').addEventListener('click', () => {
      modal.classList.remove('tm-open');
      rememberTimetableOpen(false);
    });
    modal.querySelector('[data-filter]').addEventListener('input', event => { state.filter = clean(event.target.value); invalidateTimetable(doc); renderTimetable(doc); });
    modal.querySelector('[data-restricted]').addEventListener('change', event => { state.showRestricted = event.target.checked; invalidateTimetable(doc); renderTimetable(doc); refreshRecommendations(doc, timetableCourses(doc)); });
    modal.querySelector('[data-alternatives]').addEventListener('change', event => { state.showAlternatives = event.target.checked; invalidateTimetable(doc); renderTimetable(doc); refreshRecommendations(doc, timetableCourses(doc)); });
    modal.querySelector('[data-refresh]').addEventListener('click', () => {
      if (state.loading || state.loadingRecommendations) return;
      state.cache.clear();
      state.recommendationCache.clear();
      scan(doc);
    });
    modal.querySelector('[data-clear]').addEventListener('click', () => clearPlannedSelection(doc));
    modal.querySelector('[data-submit]').addEventListener('click', () => submitPlannedSelection(doc));
    modal.querySelector('[data-grid]').addEventListener('change', event => {
      const card = event.target.closest('.tm-card');
      if (!card) return;
      if (event.target.matches('[data-pick]')) setCourseChecked(doc, card.dataset.key, event.target.checked);
      if (event.target.matches('[data-wish]')) setCourseWish(doc, card.dataset.key, event.target.value);
    });
    setPanel(state.countStatus);
    setRecommendationPanel(state.recommendationStatus);
    return modal;
  }

  function openTimetable(doc) {
    const modal = ensureTimetable(doc);
    rememberTimetableOpen(true);
    invalidateTimetable(doc);
    renderTimetable(doc);
    modal.classList.add('tm-open');
  }

  function scan(doc) {
    if (!doc?.body) return;
    const courses = mergeCourseRows(doc);
    if (state.timetableOpen) openTimetable(doc);
    const missing = [...new Set(courses.map(course => course.code))].filter(code => !state.cache.has(code));
    if (missing.length && !state.loading) refreshCounts(doc, missing);
    if (!state.loadingRecommendations) refreshRecommendations(doc, timetableCourses(doc));
  }

  function attach(doc) {
    if (state.selectionDoc === doc && doc.getElementById('tm-helper-panel')) return;
    state.observer?.disconnect();
    state.selectionDoc = doc;
    prepareCacheTerm(getTerm(doc));
    injectStyle(doc);

    const panel = doc.createElement('div');
    panel.id = 'tm-helper-panel';
    panel.innerHTML = '<button data-timetable type="button">选课课程表 <span data-alive class="tm-alive tm-alive-wait" title="正在检查登录状态">●</span></button>';
    doc.body.appendChild(panel);
    state.panel = panel;
    panel.querySelector('[data-timetable]').addEventListener('click', () => openTimetable(doc));
    if (state.timetableOpen) openTimetable(doc);

    state.observer = new MutationObserver(mutations => {
      if (mutations.every(mutation => mutation.target.parentElement?.closest?.('#tm-timetable,#tm-helper-panel,.tm-count-cell'))) return;
      clearTimeout(state.scanTimer);
      state.scanTimer = setTimeout(() => scan(doc), 250);
    });
    state.observer.observe(doc.body, { childList: true, subtree: true });
    scan(doc);
    keepSessionAlive();
  }

  if (window.__THU_COURSE_HELPER_TEST__) {
    Object.assign(window.__THU_COURSE_HELPER_TEST__, {
      sessionPingUrl, sessionExpired, rememberTimetableOpen, enrolledDocReady, extractCourseRows, extractEnrolledRows, mergeCourseRows, prepareCacheTerm, cacheStats, getRecord, parseSchedule, weeksOverlap, markConflicts, parseStatsTable, statsResponseSignature, mergeStatsResults, nextStatsPage, collectStatsPages, wishBreakdown, wishProbabilities, parseRecommendationTable, recommendationMetrics, recommendationInfo, setCourseChecked, setCourseWish,
    });
    return;
  }

  setInterval(() => {
    const doc = findSelectionDoc();
    if (doc) attach(doc);
    if (state.selectionDoc && !state.loading) scan(state.selectionDoc);
  }, 1500);

  setInterval(() => {
    if (!state.selectionDoc || state.loading) return;
    state.cache.clear();
    scan(state.selectionDoc);
  }, REFRESH_MS);

  setInterval(keepSessionAlive, KEEPALIVE_MS);
})();
