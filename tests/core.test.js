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
