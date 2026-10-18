/*
 * 核心逻辑测试（node 直接跑，不依赖任何库）：node tests/core.test.js
 * 断言与 iOS 版 XCTest 保持一致，数据来自真实种子课程。
 */
'use strict';

const assert = require('assert');
const core = require('../core.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures.push({ name, error });
  }
}

function course(overrides) {
  return Object.assign({
    id: 'id-' + Math.random().toString(16).slice(2),
    name: 'A',
    weekday: 1,
    startPeriod: 1,
    periodCount: 2,
    startWeek: 4,
    endWeek: 17,
    classroom: '',
    campus: '',
    teacher: '',
    credits: null,
    colorHex: '587DB2',
    note: '',
    isEnabled: true
  }, overrides);
}

/* ---------- 种子数据 ---------- */

test('种子课程 11 条', () => {
  assert.strictEqual(core.seedCourses().length, 11);
});

test('第 3 周没有课（都在第 4 周开始）', () => {
  assert.strictEqual(core.seedCourses().filter((c) => core.isVisible(c, 3)).length, 0);
});

test('第 4 / 11 周 11 条，第 12 / 17 周 10 条，第 18 周 0 条', () => {
  const courses = core.seedCourses();
  assert.strictEqual(courses.filter((c) => core.isVisible(c, 4)).length, 11);
  assert.strictEqual(courses.filter((c) => core.isVisible(c, 11)).length, 11);
  assert.strictEqual(courses.filter((c) => core.isVisible(c, 12)).length, 10);
  assert.strictEqual(courses.filter((c) => core.isVisible(c, 17)).length, 10);
  assert.strictEqual(courses.filter((c) => core.isVisible(c, 18)).length, 0);
});

test('同名合并后总学分 22.5', () => {
  assert.strictEqual(core.uniqueCredits(core.seedCourses()), 22.5);
});

test('种子课程没有周三以外/周四周六周日之外的课（无 4/6/7）', () => {
  const days = new Set(core.seedCourses().map((c) => c.weekday));
  assert.deepStrictEqual([...days].sort(), [1, 2, 3, 5]);
});

test('种子课程最大结束节次是第 10 节', () => {
  assert.strictEqual(Math.max(...core.seedCourses().map(core.endPeriod)), 10);
});

/* ---------- 教学周 ---------- */

test('开学当天是第 1 周，周日仍是第 1 周，下周一第 2 周', () => {
  const start = '2026-09-07';
  assert.strictEqual(core.weekNumber(core.parseISODate('2026-09-07'), start), 1);
  assert.strictEqual(core.weekNumber(core.parseISODate('2026-09-13'), start), 1);
  assert.strictEqual(core.weekNumber(core.parseISODate('2026-09-14'), start), 2);
});

test('开学前保留真实周数：第 0 周与第 -1 周', () => {
  const start = '2026-09-07';
  assert.strictEqual(core.weekNumber(core.parseISODate('2026-09-06'), start), 0);
  assert.strictEqual(core.weekNumber(core.parseISODate('2026-08-30'), start), -1);
});

test('跨年：12-28 开学，1-03 是第 1 周，1-04 是第 2 周', () => {
  const start = '2026-12-28';
  assert.strictEqual(core.weekNumber(core.parseISODate('2027-01-03'), start), 1);
  assert.strictEqual(core.weekNumber(core.parseISODate('2027-01-04'), start), 2);
});

test('weekDates 返回周一到周日', () => {
  const dates = core.weekDates('2026-12-28', 2);
  assert.strictEqual(core.toISODate(dates[0]), '2027-01-04');
  assert.strictEqual(core.toISODate(dates[6]), '2027-01-10');
});

test('mondayOf 与 isMonday', () => {
  assert.strictEqual(core.toISODate(core.mondayOf(core.parseISODate('2026-10-18'))), '2026-10-12');
  assert.strictEqual(core.isMonday(core.parseISODate('2026-10-12')), true);
  assert.strictEqual(core.isMonday(core.parseISODate('2026-10-13')), false);
});

/* ---------- 冲突 ---------- */

test('共享端点算冲突，相邻节次不算', () => {
  const a = course({ startPeriod: 1, periodCount: 2 });
  const b = course({ startPeriod: 2, periodCount: 2 });
  assert.strictEqual(core.conflicts(a, b), true);
  b.startPeriod = 3;
  assert.strictEqual(core.conflicts(a, b), false);
});

test('周次不重叠不算冲突，重叠算', () => {
  const a = course({});
  const b = course({ startWeek: 18, endWeek: 20 });
  assert.strictEqual(core.conflicts(a, b), false);
  b.startWeek = 17;
  assert.strictEqual(core.conflicts(a, b), true);
});

test('停用课程不参与冲突，自己和自己不算冲突', () => {
  const a = course({});
  const b = course({});
  b.isEnabled = false;
  assert.strictEqual(core.conflicts(a, b), false);
  assert.strictEqual(core.conflicts(a, a), false);
});

test('findConflicts 找出与候选重叠的现有课程', () => {
  const existing = [course({ name: '数学', startPeriod: 1, periodCount: 3 })];
  const candidate = course({ name: '物理', startPeriod: 3, periodCount: 2 });
  assert.strictEqual(core.findConflicts(existing, candidate).length, 1);
  candidate.startPeriod = 4;
  assert.strictEqual(core.findConflicts(existing, candidate).length, 0);
});

/* ---------- 分栏 ---------- */

test('两门重叠课程分到两道，第三门不重叠的回到第 1 道', () => {
  const a = course({ startPeriod: 1, periodCount: 2 });
  const b = course({ startPeriod: 2, periodCount: 2 });
  const c = course({ startPeriod: 4, periodCount: 1 });
  const placed = core.layoutDay([a, b, c]);
  assert.strictEqual(placed.length, 3);
  const laneOf = (x) => placed.find((p) => p.course === x).lane;
  assert.notStrictEqual(laneOf(a), laneOf(b));
  assert.strictEqual(laneOf(c), 0);
});

test('三门同时重叠时 laneCount 为 3', () => {
  const list = [
    course({ startPeriod: 1, periodCount: 3 }),
    course({ startPeriod: 1, periodCount: 3 }),
    course({ startPeriod: 2, periodCount: 1 })
  ];
  const placed = core.layoutDay(list);
  placed.forEach((p) => assert.strictEqual(p.laneCount, 3));
});

/* ---------- 时间校验 ---------- */

test('HH:mm 校验：接受合法值，拒绝非法值', () => {
  assert.strictEqual(core.minutesOf('08:05'), 485);
  assert.strictEqual(core.minutesOf('8:05'), null);
  assert.strictEqual(core.minutesOf('24:00'), null);
  assert.strictEqual(core.validTimeRange('08:00', '08:45'), true);
  assert.strictEqual(core.validTimeRange('08:45', '08:00'), false);
  assert.strictEqual(core.validTimeRange('', '08:00'), false);
});

/* ---------- 纪念日 ---------- */

test('纪念日：起始日算第 1 天，之前显示倒计时', () => {
  assert.strictEqual(core.relationshipDayNumber(core.parseISODate('2026-11-07')), 0);
  assert.strictEqual(core.relationshipLabel(core.parseISODate('2026-11-07')), '距离我们的故事开始还有 1 天');
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2026-11-07')), null);
  assert.strictEqual(core.relationshipDayNumber(core.parseISODate('2026-11-08')), 1);
  assert.strictEqual(core.relationshipDayNumber(core.parseISODate('2026-11-09')), 2);
});

test('纪念日：第 100 天是 2027-02-15', () => {
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2027-02-14')), null);
  assert.strictEqual(core.relationshipDayNumber(core.parseISODate('2027-02-15')), 100);
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2027-02-15')), '相恋 100 天快乐');
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2027-02-16')), null);
});

test('纪念日：周年按公历日期，闰年不漂移', () => {
  assert.strictEqual(core.relationshipDayNumber(core.parseISODate('2027-11-08')), 366);
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2027-11-08')), '相恋 1 周年快乐');
  assert.strictEqual(core.relationshipDayNumber(core.parseISODate('2028-11-08')), 732);
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2028-11-08')), '相恋 2 周年快乐');
  assert.strictEqual(core.relationshipMilestone(core.parseISODate('2028-11-07')), null);
});

/* ---------- 首次导入 / 持久化语义 ---------- */

test('首次 bootstrap 写入种子与标记', () => {
  const result = core.bootstrap({});
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.data.courses.length, 11);
  assert.strictEqual(result.data.otherCourses.length, 3);
  assert.strictEqual(result.data.settings.seedVersion, 1);
});

test('再次 bootstrap 不重复导入，也不覆盖用户改动', () => {
  const first = core.bootstrap({}).data;
  first.courses[0].name = '改过的名字';
  const again = core.bootstrap(first);
  assert.strictEqual(again.changed, false);
  assert.strictEqual(again.data.courses.length, 11);
  assert.strictEqual(again.data.courses[0].name, '改过的名字');
});

test('删光课程后再次 bootstrap 不会重新导入', () => {
  const data = core.bootstrap({}).data;
  data.courses = [];
  const again = core.bootstrap(data);
  assert.strictEqual(again.data.courses.length, 0);
});

test('其它课程按名称去重', () => {
  const data = core.bootstrap({}).data;
  data.otherCourses = [];
  const seeded = core.bootstrap({}).data;
  assert.strictEqual(seeded.otherCourses.length, 3);
});

/* ---------- 作业提醒 ---------- */

function assignment(overrides) {
  return Object.assign({
    id: 'a1',
    courseName: '高等数学（I-1）',
    title: '第 3 章习题',
    dueAt: '2026-10-20T22:00',
    remindBeforeMinutes: 1440,
    note: '',
    done: false
  }, overrides);
}

test('作业状态：还早 / 该做了 / 已过期 / 已完成', () => {
  const a = assignment();
  assert.strictEqual(core.assignmentState(a, new Date(2026, 9, 18, 10, 0)), 'upcoming');
  // 提前一天提醒 → 10-19 22:00 开始进入 due
  assert.strictEqual(core.assignmentState(a, new Date(2026, 9, 19, 22, 0)), 'due');
  assert.strictEqual(core.assignmentState(a, new Date(2026, 9, 20, 22, 1)), 'overdue');
  assert.strictEqual(core.assignmentState(assignment({ done: true }), new Date(2026, 9, 21, 0, 0)), 'done');
});

test('提醒时间为截止时间减去提前量', () => {
  const a = assignment({ remindBeforeMinutes: 60 });
  assert.strictEqual(core.toLocalDateTimeInput(core.assignmentRemindAt(a)), '2026-10-20T21:00');
});

test('remindLabel 文案', () => {
  assert.strictEqual(core.remindLabel(0), '不提醒');
  assert.strictEqual(core.remindLabel(30), '提前 30 分钟');
  assert.strictEqual(core.remindLabel(180), '提前 3 小时');
  assert.strictEqual(core.remindLabel(1440), '提前 1 天');
});

test('排序：未完成按截止时间升序，已完成排后面', () => {
  const list = [
    assignment({ id: 'b', dueAt: '2026-10-25T22:00' }),
    assignment({ id: 'c', dueAt: '2026-10-19T22:00', done: true }),
    assignment({ id: 'a', dueAt: '2026-10-21T22:00' })
  ];
  assert.deepStrictEqual(core.sortAssignments(list).map((x) => x.id), ['a', 'b', 'c']);
});

test('只把该提醒 / 已过期且未完成的作业挑出来', () => {
  const list = [
    assignment({ id: 'early', dueAt: '2026-11-30T22:00', remindBeforeMinutes: 60 }),
    assignment({ id: 'due', dueAt: '2026-10-20T22:00', remindBeforeMinutes: 1440 }),
    assignment({ id: 'done', dueAt: '2026-10-20T22:00', done: true })
  ];
  const picked = core.assignmentsToNotify(list, new Date(2026, 9, 20, 12, 0)).map((x) => x.id);
  assert.deepStrictEqual(picked, ['due']);
});

/* ---------- 上课提醒 ---------- */

test('nextClassOccurrence 找到下一节课并算出提醒时间', () => {
  const settings = core.defaultSettings();
  settings.semesterStartDate = '2026-09-07';
  settings.totalWeeks = 20;
  settings.periodTimes = [
    { id: 1, start: '08:00', end: '08:45' },
    { id: 2, start: '08:55', end: '09:40' }
  ];
  // 2026-10-19 是周一，第 7 周，周一第 1-2 节有大学体育
  const next = core.nextClassOccurrence(core.seedCourses(), settings, new Date(2026, 9, 19, 7, 0));
  assert.ok(next, '应该找到下一节课');
  assert.strictEqual(next.course.name, '大学体育（1）');
  assert.strictEqual(core.toLocalDateTimeInput(next.start), '2026-10-19T08:00');
});

test('没有作息时间时不产生上课提醒', () => {
  const settings = core.defaultSettings();
  settings.periodTimes = [];
  assert.strictEqual(core.nextClassOccurrence(core.seedCourses(), settings, new Date(2026, 9, 19, 7, 0)), null);
});

/* ---------- 日历导出 ---------- */

test('导出的 ics 结构正确并带提醒', () => {
  const ics = core.buildICS({
    assignments: [assignment()],
    courses: [],
    settings: core.defaultSettings(),
    includeClasses: false
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VEVENT'));
  assert.ok(ics.includes('TRIGGER:-PT1440M'));
  assert.ok(ics.includes('SUMMARY:作业截止'));
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('导出的上课日历按周重复，数量等于周数', () => {
  const settings = core.defaultSettings();
  settings.semesterStartDate = '2026-09-07';
  // 覆盖所有被课程用到的节次：1、3、5、7、9（+结束节次）
  const blank = (id, start, end) => ({ id, start, end });
  settings.periodTimes = [
    blank(1, '08:00', '08:45'), blank(2, '08:55', '09:40'),
    blank(3, '10:00', '10:45'), blank(4, '10:55', '11:40'),
    blank(5, '14:00', '14:45'), blank(6, '14:55', '15:40'),
    blank(7, '16:00', '16:45'), blank(8, '16:55', '17:40'),
    blank(9, '18:00', '18:45'), blank(10, '18:55', '19:40')
  ];
  const ics = core.buildICS({ assignments: [], courses: core.seedCourses(), settings, includeClasses: true });
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 11);
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=14'));
  assert.ok(ics.includes('BEGIN:VALARM'));
});

test('缺少节次作息时，该课程不会生成日历事件', () => {
  const settings = core.defaultSettings();
  settings.semesterStartDate = '2026-09-07';
  settings.periodTimes = [{ id: 1, start: '08:00', end: '08:45' }];
  const ics = core.buildICS({ assignments: [], courses: core.seedCourses(), settings, includeClasses: true });
  // 只有第 1 节开始的 3 门课能生成
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
});

test('ics 转义与折行', () => {
  assert.strictEqual(core.icsEscape('a,b;c'), 'a\\,b\\;c');
  assert.strictEqual(core.icsEscape('第一行\n第二行'), '第一行\\n第二行');
});

/* ---------- 每门课的具体时间 ---------- */

test('时间输入只输数字，冒号自动补', () => {
  assert.strictEqual(core.formatTimeInput('1'), '1');
  assert.strictEqual(core.formatTimeInput('12'), '12');
  assert.strictEqual(core.formatTimeInput('123'), '12:3');
  assert.strictEqual(core.formatTimeInput('1200'), '12:00');
  assert.strictEqual(core.formatTimeInput('12:00'), '12:00');
  assert.strictEqual(core.formatTimeInput('abc'), '');
});

test('失焦补全成 HH:mm', () => {
  assert.strictEqual(core.normalizeTimeInput('9'), '09:00');
  assert.strictEqual(core.normalizeTimeInput('930'), '09:30');
  assert.strictEqual(core.normalizeTimeInput('12'), '12:00');
  assert.strictEqual(core.normalizeTimeInput('1200'), '12:00');
  assert.strictEqual(core.normalizeTimeInput('12:5'), '12:05');
  assert.strictEqual(core.normalizeTimeInput(''), '');
  assert.strictEqual(core.normalizeTimeInput('25:00'), '23:00');
  assert.strictEqual(core.normalizeTimeInput('12:99'), '12:59');
});

test('课程自己的时间优先于节次作息', () => {
  const settings = core.defaultSettings();
  settings.periodTimes = [{ id: 5, start: '14:00', end: '14:45' }, { id: 6, start: '14:55', end: '15:40' }];
  const withTime = course({ startPeriod: 5, periodCount: 2, startTime: '12:00', endTime: '14:00' });
  const range = core.courseTimeRange(withTime, settings);
  assert.strictEqual(range.start, '12:00');
  assert.strictEqual(range.end, '14:00');
  assert.strictEqual(range.source, 'course');

  const without = course({ startPeriod: 5, periodCount: 2 });
  const fallback = core.courseTimeRange(without, settings);
  assert.strictEqual(fallback.start, '14:00');
  assert.strictEqual(fallback.end, '15:40');
  assert.strictEqual(fallback.source, 'period');

  assert.strictEqual(core.courseTimeRange(course({ startPeriod: 9, periodCount: 1 }), settings), null);
});

test('非法时间被忽略，退回节次作息', () => {
  const settings = core.defaultSettings();
  settings.periodTimes = [{ id: 1, start: '08:00', end: '08:45' }];
  const bad = course({ startPeriod: 1, periodCount: 1, startTime: '14:00', endTime: '12:00' });
  assert.strictEqual(core.courseTimeRange(bad, settings).source, 'period');
});

test('没有作息时间时，课程自己的时间也能导出日历', () => {
  const settings = core.defaultSettings();
  settings.semesterStartDate = '2026-09-07';
  settings.periodTimes = [];
  const custom = course({ startPeriod: 1, periodCount: 1, startTime: '12:00', endTime: '14:00', startWeek: 4, endWeek: 4 });
  const ics = core.buildICS({ assignments: [], courses: [custom], settings, includeClasses: true });
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.includes('DTSTART:'), '应有 DTSTART');
});

/* ---------- 汇总 ---------- */

if (failures.length) {
  console.error(`\n${passed} 项通过，${failures.length} 项失败：`);
  failures.forEach(({ name, error }) => {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  });
  process.exit(1);
}

console.log(`${passed} 项断言全部通过`);
