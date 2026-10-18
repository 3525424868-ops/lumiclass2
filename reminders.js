/*
 * 作业提醒 / 上课提醒
 * - 数据存在 app 的 settings/courses/assignments 里（localStorage）
 * - 提醒三层：App 内提示、网页通知（已授权且 App 开着）、导出 .ics 交给系统日历
 */
(function (global) {
  'use strict';

  var core = global.LumiCore;
  var SHOWN_KEY = 'lumiclass.web.shownReminders';
  var hooks = null;
  var editingId = null;

  function qs(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function data() { return hooks.getData(); }

  /* ---------- 已提醒记录（避免重复打扰） ---------- */

  function readShown() {
    try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}'); } catch (error) { return {}; }
  }

  function writeShown(map) {
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify(map)); } catch (error) { /* 忽略 */ }
  }

  function dayKey(date) { return core.toISODate(date); }

  function markShown(key) {
    var map = readShown();
    map[key] = Date.now();
    // 只保留最近 7 天
    var cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    Object.keys(map).forEach(function (k) { if (map[k] < cutoff) delete map[k]; });
    writeShown(map);
  }

  function wasShown(key) { return !!readShown()[key]; }

  /* ---------- 通知 ---------- */

  function ensurePermission() {
    if (!('Notification' in global)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Promise.resolve(Notification.permission);
    }
    return Notification.requestPermission();
  }

  function notify(title, body, tag) {
    if ('Notification' in global && Notification.permission === 'granted') {
      try {
        new Notification(title, { body: body, tag: tag, icon: 'icons/icon-192.png' });
        return true;
      } catch (error) { /* 有些环境不允许直接构造，退回 toast */ }
    }
    hooks.toast(title + ' · ' + body);
    return false;
  }

  /* ---------- 检查并提醒 ---------- */

  function check(now) {
    var state = data();
    var stamp = now || new Date();
    var today = dayKey(stamp);
    var fired = 0;

    state.assignments.forEach(function (assignment) {
      var status = core.assignmentState(assignment, stamp);
      if (status !== 'due' && status !== 'overdue') return;
      var key = assignment.id + ':' + status + ':' + today;
      if (wasShown(key)) return;
      var due = core.parseLocalDateTime(assignment.dueAt);
      var when = due ? (due.getMonth() + 1) + '月' + due.getDate() + '日 ' +
        String(due.getHours()).padStart(2, '0') + ':' + String(due.getMinutes()).padStart(2, '0') : '';
      var title = status === 'overdue' ? '作业已过期' : '作业即将截止';
      notify(title, (assignment.courseName ? assignment.courseName + ' · ' : '') + assignment.title + (when ? '（' + when + '）' : ''), key);
      markShown(key);
      fired++;
    });

    var reminder = state.settings.classReminder;
    if (reminder && reminder.enabled) {
      var next = core.nextClassOccurrence(state.courses, state.settings, stamp);
      if (next) {
        var remindAt = new Date(next.start.getTime() - (Number(reminder.minutesBefore) || 0) * 60000);
        var key2 = 'class:' + next.course.id + ':' + core.icsDateTime(next.start);
        if (stamp >= remindAt && stamp < next.start && !wasShown(key2)) {
          notify('快要上课了', next.course.name + ' · 第 ' + next.course.startPeriod + ' 节' +
            (next.course.classroom ? ' · ' + next.course.classroom : ''), key2);
          markShown(key2);
          fired++;
        }
      }
    }

    updateBadge();
    return fired;
  }

  function badgeCount() {
    var state = data();
    return state.assignments.filter(function (a) {
      var status = core.assignmentState(a, new Date());
      return status === 'due' || status === 'overdue';
    }).length;
  }

  function updateBadge() {
    var count = badgeCount();
    var tab = qs('btnAssignments');
    if (!tab) return;
    var dot = qs('assignBadge');
    if (!dot) {
      dot = el('span', 'tab-badge');
      dot.id = 'assignBadge';
      tab.appendChild(dot);
    }
    dot.textContent = count > 0 ? String(count) : '';
    dot.hidden = count === 0;
  }

  /* ---------- 列表 ---------- */

  function statusMeta(status) {
    if (status === 'done') return { label: '已完成', cls: 'ok' };
    if (status === 'overdue') return { label: '已过期', cls: 'bad' };
    if (status === 'due') return { label: '该做了', cls: 'warn' };
    return { label: '还早', cls: 'muted' };
  }

  function formatDue(text) {
    var date = core.parseLocalDateTime(text);
    if (!date) return '未设置截止时间';
    var weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + weekday + ' ' +
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function renderList() {
    var state = data();
    var list = qs('assignList');
    list.textContent = '';
    var items = core.sortAssignments(state.assignments);
    var summary = qs('assignSummary');
    var active = items.filter(function (a) { return !a.done; }).length;
    summary.textContent = items.length
      ? '共 ' + items.length + ' 条，未完成 ' + active + ' 条；点一条可以修改或勾完成。'
      : '还没有作业。点下面「新增作业」，填课程、截止时间和提前多久提醒。';

    items.forEach(function (assignment) {
      var status = core.assignmentState(assignment, new Date());
      var meta = statusMeta(status);
      var li = el('li', 'assign-item');
      li.dataset.id = assignment.id;

      var main = el('div', 'assign-main');
      var head = el('div', 'assign-head');
      head.appendChild(el('strong', null, assignment.title || '未命名作业'));
      var badge = el('span', 'assign-badge ' + meta.cls, meta.label);
      head.appendChild(badge);
      main.appendChild(head);

      var sub = el('div', 'assign-sub');
      sub.appendChild(el('span', null, (assignment.courseName || '未选课程') + ' · 截止 ' + formatDue(assignment.dueAt)));
      main.appendChild(sub);

      var extra = el('div', 'assign-extra');
      extra.textContent = '提醒：' + core.remindLabel(Number(assignment.remindBeforeMinutes) || 0) +
        (assignment.note ? ' · ' + assignment.note : '');
      main.appendChild(extra);

      li.appendChild(main);
      list.appendChild(li);
    });
  }

  function open() {
    renderList();
    hooks.openSheet('assign');
    updateBadge();
  }

  /* ---------- 编辑 ---------- */

  function fillCourseOptions(selectedId) {
    var select = qs('aCourse');
    select.textContent = '';
    var names = {};
    data().courses.forEach(function (course) { names[course.name] = true; });
    Object.keys(names).sort().forEach(function (name) {
      var option = el('option', null, name);
      option.value = name;
      if (name === selectedId) option.selected = true;
      select.appendChild(option);
    });
    var other = el('option', null, '其他／不在课表里');
    other.value = '__other__';
    select.appendChild(other);
  }

  function openEditor(id) {
    editingId = id || null;
    var assignment = id ? data().assignments.filter(function (a) { return a.id === id; })[0] : null;
    qs('assignEditTitle').textContent = assignment ? '编辑作业' : '新增作业';
    qs('assignError').hidden = true;
    fillCourseOptions(assignment ? assignment.courseName : null);
    qs('aTitle').value = assignment ? assignment.title : '';
    var due = assignment ? core.parseLocalDateTime(assignment.dueAt) : defaultDue();
    qs('aDue').value = due ? core.toLocalDateTimeInput(due) : '';
    qs('aRemind').value = String(assignment ? (assignment.remindBeforeMinutes || 0) : 1440);
    qs('aNote').value = assignment ? (assignment.note || '') : '';
    qs('aDone').checked = assignment ? !!assignment.done : false;
    qs('aDelete').hidden = !assignment;
    hooks.closeSheet('assign');
    hooks.openSheet('assignEdit');
    setTimeout(function () { qs('aTitle').focus(); }, 120);
  }

  function defaultDue() {
    var date = new Date();
    date.setDate(date.getDate() + 3);
    date.setHours(22, 0, 0, 0);
    return date;
  }

  function submit(event) {
    event.preventDefault();
    var error = qs('assignError');
    var title = qs('aTitle').value.trim();
    var courseName = qs('aCourse').value;
    var dueText = qs('aDue').value;
    var due = core.parseLocalDateTime(dueText);

    if (!title) { error.textContent = '请填写作业标题。'; error.hidden = false; return; }
    if (!due) { error.textContent = '请选择截止日期与时间。'; error.hidden = false; return; }

    var state = data();
    var record = {
      id: editingId || core.uid(),
      title: title,
      courseName: courseName === '__other__' ? '其他' : courseName,
      dueAt: core.toLocalDateTimeInput(due),
      remindBeforeMinutes: Number(qs('aRemind').value) || 0,
      note: qs('aNote').value.trim(),
      done: qs('aDone').checked
    };

    if (editingId) {
      state.assignments = state.assignments.map(function (a) { return a.id === record.id ? record : a; });
    } else {
      state.assignments.push(record);
    }
    hooks.save();
    hooks.closeSheet('assignEdit');
    open();
    hooks.toast(editingId ? '作业已更新' : '作业已添加');
  }

  function removeCurrent() {
    if (!editingId) return;
    if (!global.confirm('删除这条作业提醒？')) return;
    var state = data();
    state.assignments = state.assignments.filter(function (a) { return a.id !== editingId; });
    hooks.save();
    hooks.closeSheet('assignEdit');
    open();
    hooks.toast('作业已删除');
  }

  function toggleDone(id) {
    var state = data();
    state.assignments = state.assignments.map(function (a) {
      return a.id === id ? Object.assign({}, a, { done: !a.done }) : a;
    });
    hooks.save();
    renderList();
    updateBadge();
  }

  /* ---------- 导出系统日历 ---------- */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = el('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportICS() {
    var state = data();
    if (!state.assignments.length) {
      hooks.toast('还没有作业，先新增一条再导出');
      return;
    }
    var text = core.buildICS({
      assignments: state.assignments.filter(function (a) { return !a.done; }),
      courses: state.courses,
      settings: state.settings,
      includeClasses: false
    });
    download('lumiclass-homework-' + core.toISODate(new Date()) + '.ics', text);
    hooks.toast('已导出作业提醒日历，用手机打开可导入系统日历');
  }

  function exportClassICS() {
    var state = data();
    if (!state.settings.periodTimes || !state.settings.periodTimes.length) {
      hooks.toast('先在设置里填好节次作息时间，才能生成上课提醒');
      return;
    }
    var text = core.buildICS({
      assignments: [],
      courses: state.courses,
      settings: state.settings,
      includeClasses: true
    });
    download('lumiclass-classes-' + core.toISODate(new Date()) + '.ics', text);
    hooks.toast('已导出上课提醒日历，导入后由系统日历准点提醒');
  }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    qs('btnNewAssign').addEventListener('click', function () { openEditor(null); });
    qs('assignForm').addEventListener('submit', submit);
    qs('aDelete').addEventListener('click', removeCurrent);
    qs('btnExportICS').addEventListener('click', exportICS);
    qs('btnExportClassICS').addEventListener('click', exportClassICS);
    qs('assignList').addEventListener('click', function (event) {
      var item = event.target.closest('.assign-item');
      if (!item) return;
      openEditor(item.dataset.id);
    });
    qs('cDoneToggle').addEventListener('click', function () {
      if (editingId) { toggleDone(editingId); hooks.closeSheet('assignEdit'); open(); }
    });
  }

  global.LumiReminders = {
    init: function (options) {
      hooks = options;
      bind();
      updateBadge();
      ensurePermission().then(function (result) {
        if (result === 'denied') hooks.toast('通知权限被拒绝，仍可用 App 内提醒和日历导出');
      });
    },
    open: open,
    check: check,
    updateBadge: updateBadge,
    exportICS: exportICS,
    exportClassICS: exportClassICS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
