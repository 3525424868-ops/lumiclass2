/*
 * LumiClass Web —— 课表核心逻辑（无 DOM 依赖，可在 node 里直接测试）
 * 与 iOS 版 LumiClass 的算法保持一致：
 *   - 教学周按本地日历天数计算，不做秒数除法
 *   - 连续节次合并成一张卡片；同一天时间重叠的课程并排放在不同“道”里
 *   - 学分按课程名去重，同名取各时段已填学分的最大值
 *   - 初次进入写入种子数据，之后永不覆盖用户改动
 */
(function (global) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  /* ---------- 日期工具 ---------- */

  function parseISODate(iso) {
    // 'YYYY-MM-DD' -> 本地时区当天 0 点，避免 UTC 偏移把日期挪一天
    var parts = String(iso).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function toISODate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }

  function mondayOf(date) {
    var day = startOfDay(date);
    var offset = (day.getDay() + 6) % 7; // 周一 = 0
    return addDays(day, -offset);
  }

  function isMonday(date) {
    return startOfDay(date).getDay() === 1;
  }

  /** 第几教学周：周一算第 1 天；开学前是 0 或负数（故意保留真实周数） */
  function weekNumber(date, semesterStartISO) {
    var start = startOfDay(parseISODate(semesterStartISO));
    var target = startOfDay(date);
    var days = Math.round((target - start) / DAY_MS);
    return Math.floor(days / 7) + 1;
  }

  /** 某一周的 7 个日期（周一..周日） */
  function weekDates(semesterStartISO, week) {
    var start = startOfDay(parseISODate(semesterStartISO));
    var monday = addDays(start, (week - 1) * 7);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(monday, i));
    return out;
  }

  /* ---------- 课程 ---------- */

  function endPeriod(course) {
    return course.startPeriod + course.periodCount - 1;
  }

  function isVisible(course, week) {
    if (!course.isEnabled) return false;
    if (course.startWeek > course.endWeek) return false;
    return week >= course.startWeek && week <= course.endWeek;
  }

  function periodsOverlap(a, b) {
    return Math.max(a.startPeriod, b.startPeriod) <= Math.min(endPeriod(a), endPeriod(b));
  }

  function weeksOverlap(a, b) {
    return Math.max(a.startWeek, b.startWeek) <= Math.min(a.endWeek, b.endWeek);
  }

  function conflicts(a, b) {
    return a.id !== b.id &&
      a.isEnabled && b.isEnabled &&
      a.weekday === b.weekday &&
      weeksOverlap(a, b) && periodsOverlap(a, b);
  }

  /** 保存前检查：candidate 与现有课程的冲突列表 */
  function findConflicts(courses, candidate) {
    return courses.filter(function (c) { return conflicts(c, candidate); });
  }

  /**
   * 把一天的课程分配到并排的“道”里。
   * 返回 [{ course, lane, laneCount }]，渲染时按 lane/laneCount 计算宽度和左边距。
   */
  function layoutDay(courses) {
    var sorted = courses.slice().sort(function (a, b) {
      if (a.startPeriod !== b.startPeriod) return a.startPeriod - b.startPeriod;
      return String(a.id) < String(b.id) ? -1 : 1;
    });

    var lanes = []; // 每道已放的课程
    var placed = [];
    sorted.forEach(function (course) {
      var laneIndex = -1;
      for (var i = 0; i < lanes.length; i++) {
        var clash = lanes[i].some(function (other) {
          return Math.max(other.startPeriod, course.startPeriod) <=
                 Math.min(endPeriod(other), endPeriod(course));
        });
        if (!clash) { laneIndex = i; break; }
      }
      if (laneIndex === -1) {
        laneIndex = lanes.length;
        lanes.push([]);
      }
      lanes[laneIndex].push(course);
      placed.push({ course: course, lane: laneIndex });
    });

    // 只统计同一时间块内的并发道数，避免整列都被压窄
    placed.forEach(function (item) {
      var group = placed.filter(function (other) {
        return periodsOverlap(other.course, item.course);
      });
      item.laneCount = Math.max.apply(null, group.map(function (g) { return g.lane + 1; }));
    });
    placed.forEach(function (item) {
      var group = placed.filter(function (other) {
        return periodsOverlap(other.course, item.course);
      });
      item.laneCount = Math.max.apply(null, group.map(function (g) { return g.lane + 1; }));
    });
    return placed;
  }

  /** 固定课程学分：按去空白后的课程名分组，每组取最大值，再求和 */
  function uniqueCredits(courses) {
    var groups = {};
    courses.forEach(function (course) {
      var key = String(course.name).trim();
      var credit = typeof course.credits === 'number' && isFinite(course.credits) ? course.credits : 0;
      if (!groups[key] || credit > groups[key]) groups[key] = credit;
    });
    return Object.keys(groups).reduce(function (sum, key) { return sum + groups[key]; }, 0);
  }

  /* ---------- 时间字符串校验 ---------- */

  function minutesOf(text) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(text || '').trim());
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function validTimeRange(start, end) {
    var a = minutesOf(start);
    var b = minutesOf(end);
    return a !== null && b !== null && a < b;
  }

  /* ---------- 相恋天数 / 纪念日 ---------- */

  var RELATIONSHIP_START = '2025-11-08';
  var RELATIONSHIP_START_YEAR = 2025;

  function elapsedDays(date) {
    var start = startOfDay(parseISODate(RELATIONSHIP_START));
    var target = startOfDay(date);
    return Math.round((target - start) / DAY_MS);
  }

  function relationshipDayNumber(date) {
    return Math.max(0, elapsedDays(date) + 1);
  }

  function relationshipLabel(date) {
    var days = elapsedDays(date);
    if (days < 0) return '距离我们的故事开始还有 ' + (-days) + ' 天';
    if (days === 0) return '今天，我们的故事开始了';
    return '我们已经在一起 ' + (days + 1) + ' 天啦';
  }

  /** 横幅下面那行小字 */
  function relationshipSubtitle(date) {
    var days = elapsedDays(date);
    if (days < 0) return '2025.11.08 · 把喜欢写进每一天';
    return '从 2025.11.08 起 · 每天都更爱你一点';
  }

  function relationshipMilestone(date) {
    var days = elapsedDays(date);
    if (days < 0) return null;
    if (days === 0) return '故事从今天开始';
    if (days === 99) return '相恋 100 天快乐';
    var d = startOfDay(date);
    if (d.getMonth() === 10 && d.getDate() === 8 && d.getFullYear() > RELATIONSHIP_START_YEAR) {
      return '相恋 ' + (d.getFullYear() - RELATIONSHIP_START_YEAR) + ' 周年快乐';
    }
    return null;
  }

  /* ---------- 种子数据（与 iOS 版一致，来自用户提供的课表） ---------- */

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'c-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function seedCourses() {
    var rows = [
      { name: '大学体育（1）', weekday: 1, startPeriod: 1, periodCount: 2, classroom: '健美操房', campus: '南海', teacher: '刘俊', credits: 0.5, colorHex: '538E7C', note: '普拉提' },
      { name: '思政课4', weekday: 1, startPeriod: 5, periodCount: 2, classroom: '教B213', teacher: '杨婷', credits: 2, colorHex: 'AC7859' },
      { name: '程序设计基础实验', weekday: 1, startPeriod: 9, periodCount: 2, classroom: '信403A', teacher: '庞雄文', credits: 1, colorHex: '7967AA' },
      { name: '高等数学（I-1）', weekday: 2, startPeriod: 1, periodCount: 3, classroom: '教C201', teacher: '李湖南', credits: 6, colorHex: '587DB2' },
      { name: '大学生心理健康教育', weekday: 2, startPeriod: 5, periodCount: 2, endWeek: 11, classroom: '教B311', teacher: '曾保春', credits: 2, colorHex: 'AF6F88' },
      { name: '程序设计基础', weekday: 2, startPeriod: 7, periodCount: 2, classroom: '教B311', teacher: '庞雄文', credits: 2, colorHex: '7967AA' },
      { name: '思政课3', weekday: 3, startPeriod: 1, periodCount: 3, classroom: '教B312', teacher: '鄢海亮', credits: 3, colorHex: 'AC7859' },
      { name: '人工智能导论', weekday: 3, startPeriod: 5, periodCount: 2, classroom: '教B313', teacher: '曹阳', credits: 2, colorHex: '538E7C' },
      { name: '军事理论与国家安全教育', weekday: 3, startPeriod: 7, periodCount: 2, classroom: '教B313', teacher: '齐登辉', credits: 2, colorHex: '8F8552' },
      { name: '大学英语（1）', weekday: 5, startPeriod: 3, periodCount: 2, classroom: '教B311', teacher: '吴梦宇', credits: 2, colorHex: 'AF6F88' },
      { name: '高等数学（I-1）', weekday: 5, startPeriod: 5, periodCount: 3, classroom: '教C201', teacher: '李湖南', credits: 6, colorHex: '587DB2' }
    ];
    return rows.map(function (row) {
      return {
        id: uid(),
        name: row.name,
        weekday: row.weekday,
        startPeriod: row.startPeriod,
        periodCount: row.periodCount,
        startWeek: row.startWeek === undefined ? 4 : row.startWeek,
        endWeek: row.endWeek === undefined ? 17 : row.endWeek,
        classroom: row.classroom || '',
        campus: row.campus || '',
        teacher: row.teacher || '',
        credits: row.credits === undefined ? null : row.credits,
        colorHex: row.colorHex || '6A83CF',
        note: row.note || '',
        isEnabled: true
      };
    });
  }

  function seedOtherCourses() {
    return ['劳动教育', '职业生涯规划', '军事技能'].map(function (name) {
      return {
        id: uid(),
        name: name,
        credits: null,
        note: 'PDF 未提供，节次与详情待核对'
      };
    });
  }

  var DEFAULT_BG_STYLE = { blur: 8, brightness: 90, scale: 105, position: 50, overlay: 55 };

  function normalizeBackgroundStyle(style) {
    var out = {};
    Object.keys(DEFAULT_BG_STYLE).forEach(function (key) {
      out[key] = style && typeof style[key] === 'number' && isFinite(style[key]) ? style[key] : DEFAULT_BG_STYLE[key];
    });
    return out;
  }

  function defaultSettings() {
    return {
      semesterStartDate: toISODate(mondayOf(new Date())),
      totalWeeks: 20,
      selectedWeek: 1,
      automaticMode: true,
      hasCompletedSetup: false,
      seedVersion: 0,
      periodTimes: [], // [{ id: 1, start: '08:00', end: '08:45' }]
      classReminder: { enabled: false, minutesBefore: 15 },
      backgroundPhotoId: null,
      backgroundStyle: normalizeBackgroundStyle(null)
    };
  }

  /** 首次使用：写入种子；之后只补缺失项，绝不覆盖用户数据 */
  function bootstrap(data) {
    var changed = false;
    if (!data.settings) { data.settings = defaultSettings(); changed = true; }
    if (!Array.isArray(data.courses)) { data.courses = []; changed = true; }
    if (!Array.isArray(data.otherCourses)) { data.otherCourses = []; changed = true; }
    if (!Array.isArray(data.assignments)) { data.assignments = []; changed = true; }
    if (!data.settings.classReminder) {
      data.settings.classReminder = { enabled: false, minutesBefore: 15 };
      changed = true;
    }
    if (data.settings.backgroundPhotoId === undefined) {
      data.settings.backgroundPhotoId = null;
      changed = true;
    }
    var normalizedStyle = normalizeBackgroundStyle(data.settings.backgroundStyle);
    if (!data.settings.backgroundStyle ||
        Object.keys(normalizedStyle).some(function (k) { return data.settings.backgroundStyle[k] !== normalizedStyle[k]; })) {
      data.settings.backgroundStyle = normalizedStyle;
      changed = true;
    }

    if (!data.settings.seedVersion) {
      if (data.courses.length === 0) { data.courses = seedCourses(); changed = true; }
      if (data.otherCourses.length === 0) { data.otherCourses = seedOtherCourses(); changed = true; }
      data.settings.seedVersion = 1;
      changed = true;
    }
    return { data: data, changed: changed };
  }

  /* ============================================================
   * 作业提醒 / 上课提醒 / 日历导出
   * ============================================================ */

  var REMIND_CHOICES = [0, 15, 60, 180, 1440, 2880]; // 分钟

  function remindLabel(minutes) {
    if (!minutes) return '不提醒';
    if (minutes < 60) return '提前 ' + minutes + ' 分钟';
    if (minutes < 1440) return '提前 ' + (minutes / 60) + ' 小时';
    return '提前 ' + (minutes / 1440) + ' 天';
  }

  function parseLocalDateTime(text) {
    // 'YYYY-MM-DDTHH:mm' -> 本地 Date
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(text || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  }

  function toLocalDateTimeInput(date) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /** 作业状态：done 已完成 / overdue 已过期 / due 该提醒了 / upcoming 还早 */
  function assignmentState(assignment, now) {
    if (assignment.done) return 'done';
    var due = parseLocalDateTime(assignment.dueAt);
    if (!due) return 'upcoming';
    if (now >= due) return 'overdue';
    var remindAt = new Date(due.getTime() - (Number(assignment.remindBeforeMinutes) || 0) * 60000);
    if (now >= remindAt) return 'due';
    return 'upcoming';
  }

  function assignmentRemindAt(assignment) {
    var due = parseLocalDateTime(assignment.dueAt);
    if (!due) return null;
    return new Date(due.getTime() - (Number(assignment.remindBeforeMinutes) || 0) * 60000);
  }

  function sortAssignments(assignments) {
    return assignments.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      var da = parseLocalDateTime(a.dueAt);
      var db = parseLocalDateTime(b.dueAt);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    });
  }

  /** 需要弹提醒的作业（同一作业同一状态只提醒一次，由调用方记录 key） */
  function assignmentsToNotify(assignments, now) {
    return assignments.filter(function (a) {
      var state = assignmentState(a, now);
      return state === 'due' || state === 'overdue';
    });
  }

  /** 某节课下一次上课的开始时间（优先课程自己的时间，其次节次作息） */
  function nextClassOccurrence(courses, settings, now) {
    var currentWeek = weekNumber(now, settings.semesterStartDate);
    var best = null;
    for (var w = Math.max(1, currentWeek); w <= Math.min(settings.totalWeeks, Math.max(1, currentWeek) + 2); w++) {
      var monday = weekDates(settings.semesterStartDate, w)[0];
      courses.forEach(function (course) {
        if (!isVisible(course, w)) return;
        var range = courseTimeRange(course, settings);
        if (!range) return;
        var start = combineDateTime(addDays(monday, course.weekday - 1), range.start);
        if (!start || start <= now) return;
        if (!best || start < best.start) best = { course: course, start: start, week: w };
      });
    }
    return best;
  }

  function combineDateTime(dateObj, hhmm) {
    var minutes = minutesOf(hhmm);
    if (minutes === null) return null;
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(),
      Math.floor(minutes / 60), minutes % 60, 0, 0);
  }

  /* ---------- 相册排序（喜欢的优先） ---------- */

  /**
   * 相册与首页轮播的显示顺序：
   *   1) 标了“喜欢”的排在前面
   *   2) 同组内按 createdAt 从新到旧
   * 传入的数组不会被修改。
   */
  function sortPhotosForDisplay(photos) {
    return (photos || []).slice().sort(function (a, b) {
      var favA = a && a.favorite ? 1 : 0;
      var favB = b && b.favorite ? 1 : 0;
      if (favA !== favB) return favB - favA;
      return (b && b.createdAt ? b.createdAt : 0) - (a && a.createdAt ? a.createdAt : 0);
    });
  }

  function favoriteCount(photos) {
    return (photos || []).filter(function (p) { return p && p.favorite; }).length;
  }

  /* ---------- 每门课的具体时间 ---------- */

  /**
   * 优先用课程自己填的 startTime/endTime（12:00 / 14:00），
   * 没填则退回“节次 + 设置里的作息时间”。
   * 返回 { start, end, source: 'course' | 'period' } 或 null。
   */
  function courseTimeRange(course, settings) {
    if (course && course.startTime && course.endTime && validTimeRange(course.startTime, course.endTime)) {
      return { start: course.startTime, end: course.endTime, source: 'course' };
    }
    var times = (settings && settings.periodTimes) || [];
    if (!course) return null;
    var first = times.filter(function (t) { return t.id === course.startPeriod; })[0];
    var last = times.filter(function (t) { return t.id === endPeriod(course); })[0];
    if (!first || !first.start) return null;
    if (last && last.end && validTimeRange(first.start, last.end)) {
      return { start: first.start, end: last.end, source: 'period' };
    }
    // 只有开始时间时，按每节 45 分钟估算结束时间
    var minutes = minutesOf(first.start);
    if (minutes === null) return null;
    var total = minutes + 45 * Math.max(1, course.periodCount);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return { start: first.start, end: pad(Math.floor(total / 60) % 24) + ':' + pad(total % 60), source: 'period' };
  }

  /**
   * 把用户输入的数字补成 HH:mm：
   *  1 → 1     12 → 12     123 → 12:3     1234 → 12:34
   * 输入里已经带冒号也接受。
   */
  function formatTimeInput(raw) {
    var text = String(raw || '').trim();
    if (text.indexOf(':') >= 0) {
      var parts = text.split(':');
      var h = parts[0].replace(/\D/g, '').slice(0, 2);
      var m = (parts[1] || '').replace(/\D/g, '').slice(0, 2);
      return h + ':' + m;
    }
    var digits = text.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    if (digits.length === 3) return digits.slice(0, 2) + ':' + digits.slice(2);
    return digits.slice(0, 2) + ':' + digits.slice(2, 4);
  }

  /** 失焦时补全成 HH:mm：9 → 09:00，930 → 09:30，1200 → 12:00，12:5 → 12:05 */
  function normalizeTimeInput(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    var hourText;
    var minuteText;
    if (text.indexOf(':') >= 0) {
      var parts = text.split(':');
      hourText = (parts[0] || '').replace(/\D/g, '');
      minuteText = (parts[1] || '').replace(/\D/g, '');
    } else {
      var digits = text.replace(/\D/g, '');
      if (digits.length <= 2) { hourText = digits; minuteText = ''; }
      else if (digits.length === 3) { hourText = digits.slice(0, 1); minuteText = digits.slice(1); }
      else { hourText = digits.slice(0, 2); minuteText = digits.slice(2, 4); }
    }
    if (!hourText) return '';
    var hour = Math.min(23, Number(hourText));
    var minute = minuteText ? Math.min(59, Number(minuteText)) : 0;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(hour) + ':' + pad(minute);
  }

  /* ---------- .ics 日历导出（系统日历负责准点提醒） ---------- */

  function icsDateTime(date) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + 'T' +
      pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  }

  function icsEscape(text) {
    return String(text || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function icsFold(line) {
    // RFC 5545：超过 75 字节要折行
    var out = [];
    var bytes = 0;
    var chunk = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var size = encodeURIComponent(ch).replace(/%[0-9A-F]{2}/g, 'x').length;
      if (bytes + size > 73) {
        out.push(chunk);
        chunk = ' ' + ch;
        bytes = 1 + size;
      } else {
        chunk += ch;
        bytes += size;
      }
    }
    out.push(chunk);
    return out.join('\r\n');
  }

  function buildICS(options) {
    var assignments = options.assignments || [];
    var courses = options.courses || [];
    var settings = options.settings || defaultSettings();
    var includeClasses = options.includeClasses !== false;
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LumiClass//Timetable//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:LumiClass 课表与作业'
    ];

    assignments.forEach(function (a) {
      var due = parseLocalDateTime(a.dueAt);
      if (!due) return;
      var trigger = Number(a.remindBeforeMinutes) || 0;
      var courseName = a.courseName || '作业';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + (a.id || uid()) + '@lumiclass');
      lines.push('DTSTAMP:' + icsDateTime(new Date()));
      lines.push('DTSTART:' + icsDateTime(due));
      lines.push('DTEND:' + icsDateTime(new Date(due.getTime() + 30 * 60000)));
      lines.push(icsFold('SUMMARY:' + icsEscape('作业截止：' + courseName + ' · ' + a.title)));
      if (a.note) lines.push(icsFold('DESCRIPTION:' + icsEscape(a.note)));
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('TRIGGER:-PT' + Math.max(1, trigger) + 'M');
      lines.push(icsFold('DESCRIPTION:' + icsEscape('作业即将截止：' + a.title)));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });

    if (includeClasses) {
      courses.forEach(function (course) {
        if (!course.isEnabled) return;
        var range = courseTimeRange(course, settings);
        if (!range) return;
        var firstMonday = weekDates(settings.semesterStartDate, Math.max(1, course.startWeek))[0];
        var firstDay = addDays(firstMonday, course.weekday - 1);
        var start = combineDateTime(firstDay, range.start);
        var end = combineDateTime(firstDay, range.end) || new Date(start.getTime() + course.periodCount * 45 * 60000);
        var count = Math.max(1, course.endWeek - Math.max(1, course.startWeek) + 1);
        var minutes = Number(settings.classReminder && settings.classReminder.minutesBefore) || 15;
        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + course.id + '-class@lumiclass');
        lines.push('DTSTAMP:' + icsDateTime(new Date()));
        lines.push('DTSTART:' + icsDateTime(start));
        lines.push('DTEND:' + icsDateTime(end));
        lines.push('RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=' + count);
        lines.push(icsFold('SUMMARY:' + icsEscape(course.name + (course.classroom ? '（' + course.classroom + '）' : ''))));
        lines.push(icsFold('LOCATION:' + icsEscape([course.campus, course.classroom].filter(Boolean).join(' · '))));
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('TRIGGER:-PT' + Math.max(1, minutes) + 'M');
        lines.push(icsFold('DESCRIPTION:' + icsEscape('马上上课：' + course.name)));
        lines.push('END:VALARM');
        lines.push('END:VEVENT');
      });
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  var api = {
    parseISODate: parseISODate,
    toISODate: toISODate,
    startOfDay: startOfDay,
    addDays: addDays,
    mondayOf: mondayOf,
    isMonday: isMonday,
    weekNumber: weekNumber,
    weekDates: weekDates,
    endPeriod: endPeriod,
    isVisible: isVisible,
    conflicts: conflicts,
    findConflicts: findConflicts,
    layoutDay: layoutDay,
    uniqueCredits: uniqueCredits,
    minutesOf: minutesOf,
    validTimeRange: validTimeRange,
    relationshipDayNumber: relationshipDayNumber,
    relationshipLabel: relationshipLabel,
    relationshipSubtitle: relationshipSubtitle,
    relationshipMilestone: relationshipMilestone,
    seedCourses: seedCourses,
    seedOtherCourses: seedOtherCourses,
    defaultSettings: defaultSettings,
    bootstrap: bootstrap,
    uid: uid,
    RELATIONSHIP_START: RELATIONSHIP_START,
    // 作业与提醒
    REMIND_CHOICES: REMIND_CHOICES,
    remindLabel: remindLabel,
    parseLocalDateTime: parseLocalDateTime,
    toLocalDateTimeInput: toLocalDateTimeInput,
    assignmentState: assignmentState,
    assignmentRemindAt: assignmentRemindAt,
    sortAssignments: sortAssignments,
    assignmentsToNotify: assignmentsToNotify,
    nextClassOccurrence: nextClassOccurrence,
    combineDateTime: combineDateTime,
    buildICS: buildICS,
    icsDateTime: icsDateTime,
    icsEscape: icsEscape,
    DEFAULT_BG_STYLE: DEFAULT_BG_STYLE,
    normalizeBackgroundStyle: normalizeBackgroundStyle,
    courseTimeRange: courseTimeRange,
    formatTimeInput: formatTimeInput,
    normalizeTimeInput: normalizeTimeInput,
    sortPhotosForDisplay: sortPhotosForDisplay,
    favoriteCount: favoriteCount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LumiCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
