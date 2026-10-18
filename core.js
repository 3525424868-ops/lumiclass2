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

  var RELATIONSHIP_START = '2026-11-08';

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
    return days < 0
      ? '距离我们的故事开始还有 ' + (-days) + ' 天'
      : '相恋第 ' + (days + 1) + ' 天';
  }

  function relationshipMilestone(date) {
    var days = elapsedDays(date);
    if (days < 0) return null;
    if (days === 0) return '故事从今天开始';
    if (days === 99) return '相恋 100 天快乐';
    var d = startOfDay(date);
    if (d.getMonth() === 10 && d.getDate() === 8 && d.getFullYear() > 2026) {
      return '相恋 ' + (d.getFullYear() - 2026) + ' 周年快乐';
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

  function defaultSettings() {
    return {
      semesterStartDate: toISODate(mondayOf(new Date())),
      totalWeeks: 20,
      selectedWeek: 1,
      automaticMode: true,
      hasCompletedSetup: false,
      seedVersion: 0,
      periodTimes: [] // [{ id: 1, start: '08:00', end: '08:45' }]
    };
  }

  /** 首次使用：写入种子；之后只补缺失项，绝不覆盖用户数据 */
  function bootstrap(data) {
    var changed = false;
    if (!data.settings) { data.settings = defaultSettings(); changed = true; }
    if (!Array.isArray(data.courses)) { data.courses = []; changed = true; }
    if (!Array.isArray(data.otherCourses)) { data.otherCourses = []; changed = true; }

    if (!data.settings.seedVersion) {
      if (data.courses.length === 0) { data.courses = seedCourses(); changed = true; }
      if (data.otherCourses.length === 0) { data.otherCourses = seedOtherCourses(); changed = true; }
      data.settings.seedVersion = 1;
      changed = true;
    }
    return { data: data, changed: changed };
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
    relationshipMilestone: relationshipMilestone,
    seedCourses: seedCourses,
    seedOtherCourses: seedOtherCourses,
    defaultSettings: defaultSettings,
    bootstrap: bootstrap,
    uid: uid,
    RELATIONSHIP_START: RELATIONSHIP_START
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LumiCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
