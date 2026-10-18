/*
 * LumiClass Web —— 界面逻辑
 * 数据全部存在浏览器 localStorage，不联网、无账号。
 */
(function () {
  'use strict';

  var core = window.LumiCore;
  var STORAGE_KEY = 'lumiclass.web.v1';
  var BACKUP_KEY = 'lumiclass.web.backup';
  var COLOR_CHOICES = ['587DB2', '538E7C', '7967AA', 'AC7859', 'AF6F88', '8F8552'];
  var WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

  var state = {
    data: null,
    viewWeek: null,
    editingId: null,
    detailId: null,
    selectedColor: COLOR_CHOICES[0]
  };

  /* ---------- DOM 小工具 ---------- */

  function qs(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function cssPx(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var value = parseFloat(raw);
    return isFinite(value) ? value : fallback;
  }

  var toastTimer = null;
  function toast(message) {
    var node = qs('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2200);
  }

  /* ---------- 存储 ---------- */

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (error) { raw = null; }

    var data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        // 不覆盖用户数据：坏数据另存一份再重建
        try { localStorage.setItem(BACKUP_KEY, raw); } catch (e) { /* 忽略 */ }
        toast('本地数据读取失败，已保留备份并重新开始');
        data = null;
      }
    }
    if (!data || typeof data !== 'object') data = {};

    var result = core.bootstrap(data);
    state.data = result.data;
    if (result.changed || !raw) save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      return true;
    } catch (error) {
      toast('保存失败：浏览器存储空间不足或被禁用');
      return false;
    }
  }

  /* ---------- 派生数据 ---------- */

  function settings() { return state.data.settings; }
  function today() { return core.startOfDay(new Date()); }
  function currentWeekNumber() { return core.weekNumber(new Date(), settings().semesterStartDate); }

  function activeWeek() {
    if (state.viewWeek !== null) return state.viewWeek;
    var s = settings();
    return s.automaticMode ? currentWeekNumber() : s.selectedWeek;
  }

  function setWeek(week) {
    var s = settings();
    s.selectedWeek = Math.min(Math.max(1, week), s.totalWeeks);
    s.automaticMode = false;
    state.viewWeek = s.selectedWeek;
    save();
    render();
  }

  function goToCurrentWeek() {
    var s = settings();
    s.automaticMode = true;
    s.selectedWeek = Math.min(Math.max(1, currentWeekNumber()), s.totalWeeks);
    state.viewWeek = null;
    save();
    render();
  }

  function visibleCourses(week) {
    return state.data.courses.filter(function (course) { return core.isVisible(course, week); });
  }

  function periodCount() {
    var maxEnd = 10;
    state.data.courses.forEach(function (course) {
      maxEnd = Math.max(maxEnd, core.endPeriod(course));
    });
    return Math.min(Math.max(maxEnd, 10), 14);
  }

  function findCourse(id) {
    return state.data.courses.filter(function (course) { return course.id === id; })[0] || null;
  }

  function timeLabel(start, end) {
    var times = settings().periodTimes || [];
    var first = times.filter(function (t) { return t.id === start; })[0];
    var last = times.filter(function (t) { return t.id === end; })[0];
    if (!first || !last || !first.start || !last.end) return null;
    return first.start + '–' + last.end;
  }

  function weekdayName(day) { return '周' + WEEKDAY_NAMES[day - 1]; }

  /* ---------- 渲染：顶栏 ---------- */

  function renderTop() {
    var now = today();
    var milestone = core.relationshipMilestone(now);
    qs('loveIcon').textContent = milestone ? '🎁' : '♥';
    qs('loveLabel').textContent = core.relationshipLabel(now);
    qs('loveSub').textContent = milestone
      ? milestone + ' · 点开小惊喜'
      : '2026.11.08 · 把喜欢写进每一天';

    var week = activeWeek();
    qs('weekNumber').textContent = week;
    qs('prevWeek').disabled = week <= 1;
    qs('nextWeek').disabled = week >= settings().totalWeeks;

    var s = settings();
    var count = visibleCourses(week).length;
    var status;
    if (week < 1) status = '学期尚未开始 · 自动模式';
    else if (week > s.totalWeeks) status = '学期已结束 · 自动模式';
    else status = (s.automaticMode ? '自动' : '浏览') + '模式 · 本周 ' + count + ' 个上课时段';
    qs('statusText').textContent = status;
    qs('backToNow').hidden = s.automaticMode;
  }

  /* ---------- 渲染：课表 ---------- */

  function renderGrid() {
    var week = activeWeek();
    var rows = periodCount();
    var rowH = cssPx('--row-h', 78);
    var grid = qs('timetable');
    grid.textContent = '';

    var periodCol = el('div', 'period-col');
    for (var p = 1; p <= rows; p++) {
      var cell = el('div', 'period-cell');
      cell.appendChild(el('span', null, String(p)));
      var time = (settings().periodTimes || []).filter(function (t) { return t.id === p; })[0];
      if (time && time.start && time.end) {
        var small = el('small');
        small.innerHTML = time.start + '<br>' + time.end;
        cell.appendChild(small);
      }
      periodCol.appendChild(cell);
    }
    grid.appendChild(periodCol);

    var days = el('div', 'days');
    var dates = core.weekDates(settings().semesterStartDate, week);
    var todayISO = core.toISODate(today());
    var weekCourses = visibleCourses(week);

    for (var day = 1; day <= 7; day++) {
      var column = el('div', 'day-col');
      var date = dates[day - 1];
      if (core.toISODate(date) === todayISO) column.classList.add('today');

      var head = el('div', 'day-head');
      head.appendChild(el('span', null, '周' + WEEKDAY_NAMES[day - 1]));
      head.appendChild(el('small', null, (date.getMonth() + 1) + '/' + date.getDate()));
      column.appendChild(head);

      var body = el('div', 'day-body');
      body.style.height = (rows * rowH) + 'px';
      for (var line = 1; line < rows; line++) {
        var slotLine = el('div', 'slot-line');
        slotLine.style.top = (line * rowH) + 'px';
        body.appendChild(slotLine);
      }

      var dayCourses = weekCourses.filter(function (course) { return course.weekday === day; });
      core.layoutDay(dayCourses).forEach(function (item) {
        body.appendChild(buildCard(item, rowH));
      });

      column.appendChild(body);
      days.appendChild(column);
    }
    grid.appendChild(days);

    qs('emptyHint').hidden = weekCourses.length > 0;
  }

  function buildCard(item, rowH) {
    var course = item.course;
    var card = el('button', 'course-card');
    card.type = 'button';
    card.dataset.courseId = course.id;
    if (!course.isEnabled) card.classList.add('disabled');

    var laneWidth = 100 / item.laneCount;
    card.style.top = ((course.startPeriod - 1) * rowH + 2) + 'px';
    card.style.height = (course.periodCount * rowH - 6) + 'px';
    card.style.left = (item.lane * laneWidth) + '%';
    card.style.width = 'calc(' + laneWidth + '% - 2px)';
    card.style.background = '#' + course.colorHex + '22';
    card.style.borderColor = '#' + course.colorHex + '55';

    var bar = el('span', 'bar');
    bar.style.background = '#' + course.colorHex;
    card.appendChild(bar);
    card.appendChild(el('span', 'name', course.name));
    if (course.classroom) card.appendChild(el('span', 'room', course.classroom));

    card.setAttribute('aria-label',
      course.name + '，' + weekdayName(course.weekday) + '，第 ' + course.startPeriod + ' 至 ' +
      core.endPeriod(course) + ' 节，' + (course.classroom || '未填写教室'));
    return card;
  }

  /* ---------- 首页照片轮播 ---------- */

  var carouselTimer = null;

  function renderCarousel() {
    var wrap = qs('photoCarousel');
    var track = qs('carouselTrack');
    if (!wrap || !track) return;

    var show = settings().showCarousel !== false;
    var album = window.LumiAlbum;
    var photos = album && album.list ? album.list() : [];
    if (!show || !photos.length) {
      wrap.hidden = true;
      track.textContent = '';
      return;
    }

    track.textContent = '';
    photos.forEach(function (photo, index) {
      var card = el('button', 'carousel-card');
      card.type = 'button';
      card.dataset.index = String(index);
      var img = el('img');
      img.src = album.thumbUrl(photo);
      img.alt = photo.name || '照片';
      img.loading = 'lazy';
      card.appendChild(img);
      if (index === 0) card.appendChild(el('span', 'cap', photos.length + ' 个回忆 · 点我看大图'));
      track.appendChild(card);
    });
    wrap.hidden = false;
    startCarouselAuto(track);
  }

  function startCarouselAuto(track) {
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    carouselTimer = setInterval(function () {
      if (document.hidden || document.querySelector('.sheet:not([hidden])')) return;
      var cards = track.children;
      if (!cards.length) return;
      var step = cards[0].getBoundingClientRect().width + 8;
      var next = Math.round(track.scrollLeft / step) + 1;
      if (next >= cards.length) next = 0;
      track.scrollTo({ left: next * step, behavior: 'smooth' });
    }, 4000);
  }

  function render() {
    renderTop();
    renderGrid();
  }

  /* ---------- 弹层 ---------- */

  var openSheets = [];

  function openSheet(name) {
    var sheet = qs(name + 'Sheet');
    if (!sheet) return;
    sheet.hidden = false;
    openSheets.push(name);
  }

  function closeSheet(name) {
    var sheet = qs(name + 'Sheet');
    if (sheet) sheet.hidden = true;
    openSheets = openSheets.filter(function (item) { return item !== name; });
  }

  function closeAllSheets() {
    openSheets.slice().forEach(closeSheet);
    openSheets = [];
  }

  /* ---------- 课程详情 ---------- */

  function showDetail(id) {
    var course = findCourse(id);
    if (!course) return;
    state.detailId = id;

    qs('detailTitle').textContent = course.name;
    qs('detailColor').style.background = '#' + course.colorHex;

    var grid = qs('detailGrid');
    grid.textContent = '';
    var rows = [
      ['上课', weekdayName(course.weekday) + ' · ' + course.startPeriod + '–' + core.endPeriod(course) + ' 节'],
      ['时间', timeLabel(course.startPeriod, core.endPeriod(course)) || '未填写作息时间'],
      ['地点', [course.campus, course.classroom].filter(Boolean).join(' · ') || '未填写'],
      ['教师', course.teacher || '未填写'],
      ['学分', typeof course.credits === 'number' ? String(course.credits) : '未填写'],
      ['周次', '第 ' + course.startWeek + '–' + course.endWeek + ' 周'],
      ['状态', course.isEnabled ? '启用' : '已停用']
    ];
    if (course.note) rows.push(['备注', course.note]);
    rows.forEach(function (row) {
      grid.appendChild(el('dt', null, row[0]));
      grid.appendChild(el('dd', null, row[1]));
    });

    openSheet('detail');
  }

  /* ---------- 课程编辑 ---------- */

  function buildColorRow() {
    var row = qs('colorRow');
    row.textContent = '';
    COLOR_CHOICES.forEach(function (hex) {
      var dot = el('button', 'color-dot');
      dot.type = 'button';
      dot.style.background = '#' + hex;
      dot.dataset.hex = hex;
      dot.setAttribute('aria-label', '颜色 ' + hex);
      dot.setAttribute('aria-pressed', hex === state.selectedColor ? 'true' : 'false');
      dot.addEventListener('click', function () {
        state.selectedColor = hex;
        Array.prototype.forEach.call(row.children, function (child) {
          child.setAttribute('aria-pressed', child.dataset.hex === hex ? 'true' : 'false');
        });
      });
      row.appendChild(dot);
    });
  }

  function openEditor(id) {
    state.editingId = id || null;
    var course = id ? findCourse(id) : null;
    var s = settings();

    qs('editorTitle').textContent = course ? '编辑课程' : '添加课程';
    qs('formError').hidden = true;

    qs('fName').value = course ? course.name : '';
    qs('fTeacher').value = course ? course.teacher : '';
    qs('fCredits').value = course && typeof course.credits === 'number' ? String(course.credits) : '';
    qs('fWeekday').value = String(course ? course.weekday : 1);
    qs('fStart').value = String(course ? course.startPeriod : 1);
    qs('fCount').value = String(course ? course.periodCount : 2);
    qs('fFrom').value = String(course ? course.startWeek : Math.min(4, s.totalWeeks));
    qs('fTo').value = String(course ? course.endWeek : Math.min(17, s.totalWeeks));
    qs('fCampus').value = course ? course.campus : '';
    qs('fClassroom').value = course ? course.classroom : '';
    qs('fNote').value = course ? course.note : '';
    qs('fEnabled').checked = course ? course.isEnabled : true;
    state.selectedColor = course ? course.colorHex : COLOR_CHOICES[0];
    buildColorRow();

    qs('btnDelete').hidden = !course;
    closeSheet('detail');
    openSheet('editor');
    setTimeout(function () { qs('fName').focus(); }, 120);
  }

  function collectCourse() {
    var name = qs('fName').value.trim();
    if (!name) return { error: '请填写课程名称。' };

    var weekday = Number(qs('fWeekday').value);
    var startPeriod = Number(qs('fStart').value);
    var count = Number(qs('fCount').value);
    var from = Number(qs('fFrom').value);
    var to = Number(qs('fTo').value);
    var creditsText = qs('fCredits').value.trim();

    if (!(startPeriod >= 1 && startPeriod <= 14)) return { error: '开始节次必须在 1–14 之间。' };
    if (!(count >= 1 && count <= 14)) return { error: '连续节数必须在 1–14 之间。' };
    if (startPeriod + count - 1 > 14) return { error: '结束节次超过第 14 节，请调整。' };
    if (!(from >= 1)) return { error: '开始周必须大于 0。' };
    if (from > to) return { error: '开始周不能晚于结束周。' };

    var credits = null;
    if (creditsText) {
      var parsed = Number(creditsText);
      if (!isFinite(parsed) || parsed < 0) return { error: '学分需要填非负数字，或留空。' };
      credits = parsed;
    }

    return {
      course: {
        id: state.editingId || core.uid(),
        name: name,
        weekday: weekday,
        startPeriod: startPeriod,
        periodCount: count,
        startWeek: from,
        endWeek: to,
        classroom: qs('fClassroom').value.trim(),
        campus: qs('fCampus').value.trim(),
        teacher: qs('fTeacher').value.trim(),
        credits: credits,
        colorHex: state.selectedColor,
        note: qs('fNote').value.trim(),
        isEnabled: qs('fEnabled').checked
      }
    };
  }

  function submitCourse(event) {
    event.preventDefault();
    var result = collectCourse();
    var error = qs('formError');
    if (result.error) {
      error.textContent = result.error;
      error.hidden = false;
      return;
    }

    var candidate = result.course;
    var others = state.data.courses.filter(function (c) { return c.id !== candidate.id; });
    var clashes = core.findConflicts(others, candidate);
    if (clashes.length) {
      error.textContent = '与「' + clashes.map(function (c) { return c.name; }).join('」「') +
        '」时间冲突，请调整星期、节次或周数后再保存。';
      error.hidden = false;
      return;
    }

    if (state.editingId) {
      state.data.courses = state.data.courses.map(function (c) {
        return c.id === candidate.id ? candidate : c;
      });
    } else {
      state.data.courses.push(candidate);
    }
    save();
    closeSheet('editor');
    render();
    toast(state.editingId ? '已保存修改' : '已添加课程');
  }

  function deleteCourse() {
    var id = state.editingId;
    if (!id) return;
    var course = findCourse(id);
    if (!course) return;
    if (!window.confirm('确定删除「' + course.name + '」这个时段？')) return;
    state.data.courses = state.data.courses.filter(function (c) { return c.id !== id; });
    save();
    closeSheet('editor');
    render();
    toast('已删除');
  }

  /* ---------- 学期设置 ---------- */

  function buildPeriodRows() {
    var container = qs('periodRows');
    container.textContent = '';
    var existing = settings().periodTimes || [];
    for (var p = 1; p <= 14; p++) {
      var found = existing.filter(function (t) { return t.id === p; })[0];
      var row = el('label', 'period-row');
      row.appendChild(el('strong', null, String(p)));

      var startInput = el('input');
      startInput.type = 'text';
      startInput.inputMode = 'numeric';
      startInput.placeholder = '--:--';
      startInput.value = found ? found.start : '';
      startInput.dataset.period = String(p);
      startInput.dataset.kind = 'start';

      var endInput = el('input');
      endInput.type = 'text';
      endInput.inputMode = 'numeric';
      endInput.placeholder = '--:--';
      endInput.value = found ? found.end : '';
      endInput.dataset.period = String(p);
      endInput.dataset.kind = 'end';

      row.appendChild(startInput);
      row.appendChild(el('span', null, '–'));
      row.appendChild(endInput);
      container.appendChild(row);
    }
  }

  function bgStyle() {
    var s = settings();
    s.backgroundStyle = core.normalizeBackgroundStyle(s.backgroundStyle);
    return s.backgroundStyle;
  }

  var BG_SLIDERS = [
    { id: 'bgBlur', key: 'blur', out: 'bgBlurOut', format: function (v) { return v + ' px'; } },
    { id: 'bgBrightness', key: 'brightness', out: 'bgBrightnessOut', format: function (v) { return v + '%'; } },
    { id: 'bgScale', key: 'scale', out: 'bgScaleOut', format: function (v) { return v + '%'; } },
    { id: 'bgPosition', key: 'position', out: 'bgPositionOut', format: function (v) { return v + '%'; } },
    { id: 'bgOverlay', key: 'overlay', out: 'bgOverlayOut', format: function (v) { return v + '%'; } }
  ];

  function renderBackgroundControls() {
    var style = bgStyle();
    BG_SLIDERS.forEach(function (slider) {
      var input = qs(slider.id);
      var output = qs(slider.out);
      if (!input) return;
      input.value = String(style[slider.key]);
      if (output) output.textContent = slider.format(style[slider.key]);
    });
    var status = qs('bgStatus');
    if (status) {
      status.textContent = settings().backgroundPhotoId
        ? '当前：使用相册照片作背景（可在下面调节）'
        : '当前：粉色渐变（在相册里点开照片 →「设为课表背景」）';
    }
  }

  function bindBackgroundControls() {
    BG_SLIDERS.forEach(function (slider) {
      var input = qs(slider.id);
      if (!input) return;
      input.addEventListener('input', function () {
        var style = bgStyle();
        style[slider.key] = Number(input.value);
        var output = qs(slider.out);
        if (output) output.textContent = slider.format(Number(input.value));
        if (window.LumiAlbum) window.LumiAlbum.applyBackground();
      });
      input.addEventListener('change', function () {
        bgStyle()[slider.key] = Number(input.value);
        save();
      });
    });

    var clear = qs('btnClearBg');
    if (clear) {
      clear.addEventListener('click', function () {
        settings().backgroundPhotoId = null;
        save();
        if (window.LumiAlbum) window.LumiAlbum.applyBackground();
        renderBackgroundControls();
        toast('已恢复粉色背景');
      });
    }
  }

  function openSettings(onboarding) {
    var s = settings();
    qs('settingsTitle').textContent = onboarding ? '设置你的学期' : '设置';
    qs('onboardingHint').hidden = !onboarding;
    qs('sStart').value = s.semesterStartDate;
    qs('sWeeks').value = String(s.totalWeeks);
    qs('sAuto').checked = !!s.automaticMode;
    var reminder = s.classReminder || { enabled: false, minutesBefore: 15 };
    qs('sClassRemind').checked = !!reminder.enabled;
    qs('sClassMinutes').value = String(reminder.minutesBefore || 15);
    qs('sCarousel').checked = s.showCarousel !== false;
    qs('startError').hidden = true;
    qs('settingsError').hidden = true;
    renderBackgroundControls();
    buildPeriodRows();
    // 开了上课提醒却没填作息时，自动展开节次时间，避免“找不到在哪填”
    var details = qs('periodDetails');
    if (details) {
      details.open = !!reminder.enabled && !(s.periodTimes && s.periodTimes.length);
    }
    openSheet('settings');
  }

  function submitSettings(event) {
    event.preventDefault();
    var startDate = qs('sStart').value;
    var weeks = Number(qs('sWeeks').value);
    var startError = qs('startError');
    var errorBox = qs('settingsError');

    if (!startDate || !core.isMonday(core.parseISODate(startDate))) {
      startError.hidden = false;
      return;
    }
    startError.hidden = true;

    if (!(weeks >= 1 && weeks <= 60)) {
      errorBox.textContent = '学期总周数需要在 1–60 之间。';
      errorBox.hidden = false;
      return;
    }

    var collected = {};
    var inputs = qs('periodRows').querySelectorAll('input');
    Array.prototype.forEach.call(inputs, function (input) {
      var id = Number(input.dataset.period);
      collected[id] = collected[id] || { id: id, start: '', end: '' };
      collected[id][input.dataset.kind] = input.value.trim();
    });

    var times = [];
    var invalid = null;
    Object.keys(collected).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      var row = collected[id];
      if (!row.start && !row.end) return;
      if (!core.validTimeRange(row.start, row.end)) {
        if (!invalid) invalid = id;
        return;
      }
      times.push({ id: id, start: row.start, end: row.end });
    });

    if (invalid) {
      errorBox.textContent = '第 ' + invalid + ' 节的时间无效：请填 HH:mm，且结束时间晚于开始时间。';
      errorBox.hidden = false;
      return;
    }

    var reminderOn = qs('sClassRemind').checked;    if (reminderOn && !times.length) {
      errorBox.textContent = '要开启上课提醒，需要先在上面「节次时间」里填至少一节的作息（比如第 1 节 08:00–08:45）。';
      errorBox.hidden = false;
      var detailsOpen = qs('periodDetails');
      if (detailsOpen) detailsOpen.open = true;
      return;
    }

    var s = settings();
    s.semesterStartDate = startDate;
    s.totalWeeks = weeks;
    s.automaticMode = qs('sAuto').checked;
    s.selectedWeek = Math.min(Math.max(1, s.selectedWeek), weeks);
    s.periodTimes = times;
    s.showCarousel = qs('sCarousel').checked;
    s.classReminder = {
      enabled: qs('sClassRemind').checked,
      minutesBefore: Number(qs('sClassMinutes').value) || 15
    };
    s.hasCompletedSetup = true;
    state.viewWeek = null;
    save();
    closeSheet('settings');
    render();
    toast('设置已保存');
  }

  /* ---------- 全部课程 ---------- */

  function openCourseList() {
    var courses = state.data.courses.slice().sort(function (a, b) {
      return a.startPeriod - b.startPeriod || a.weekday - b.weekday;
    });
    var total = core.uniqueCredits(courses);
    qs('creditSummary').textContent = '固定课程学分：' + (Math.round(total * 100) / 100) +
      '（同名课程只计一次，取各时段最大值）';

    var list = qs('courseList');
    list.textContent = '';
    courses.forEach(function (course) {
      var li = el('li');
      li.dataset.courseId = course.id;
      var dot = el('span', 'dot');
      dot.style.background = '#' + course.colorHex;
      li.appendChild(dot);
      var info = el('div', 'info');
      info.appendChild(el('strong', null, course.name));
      info.appendChild(el('small', null,
        weekdayName(course.weekday) + ' · ' + course.startPeriod + '–' + core.endPeriod(course) + ' 节 · 第 ' +
        course.startWeek + '–' + course.endWeek + ' 周' + (course.isEnabled ? '' : ' · 已停用')));
      li.appendChild(info);
      list.appendChild(li);
    });

    var otherList = qs('otherList');
    otherList.textContent = '';
    state.data.otherCourses.forEach(function (course) {
      var li = el('li');
      var info = el('div', 'info');
      info.appendChild(el('strong', null, course.name));
      info.appendChild(el('small', null, course.note || '待核对'));
      li.appendChild(info);
      otherList.appendChild(li);
    });

    openSheet('list');
  }

  function exportBackup() {
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = el('a');
    link.href = url;
    link.download = 'lumiclass-backup-' + core.toISODate(today()) + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('备份已导出');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.courses)) throw new Error('bad file');
        if (!window.confirm('导入会覆盖当前课程与设置，确定继续？')) return;
        var result = core.bootstrap(parsed);
        state.data = result.data;
        state.viewWeek = null;
        save();
        closeSheet('list');
        render();
        toast('已导入备份');
      } catch (error) {
        toast('这个文件不是有效的备份');
      }
    };
    reader.readAsText(file);
  }

  /* ---------- 周次选择 ---------- */

  function openWeekPicker() {
    var grid = qs('weekGrid');
    grid.textContent = '';
    var week = activeWeek();
    for (var w = 1; w <= settings().totalWeeks; w++) {
      var cell = el('button', 'week-cell', String(w));
      cell.type = 'button';
      cell.dataset.week = String(w);
      if (w === week) cell.setAttribute('aria-current', 'true');
      grid.appendChild(cell);
    }
    openSheet('week');
  }

  /* ---------- 纪念卡 ---------- */

  function openLoveCard() {
    var now = today();
    var milestone = core.relationshipMilestone(now);
    qs('loveCardTitle').textContent = milestone || '喜欢你，是每天的小确幸';
    qs('loveCardDays').textContent = core.relationshipLabel(now);
    qs('loveCardNote').textContent = milestone
      ? '课表会翻到下一周，喜欢你会写进每一天。'
      : '从 2026 年 11 月 8 日开始，一起收藏平凡日子里的小美好。第 100 天与每个周年当天，再来点点小惊喜吧。';
    openSheet('love');
  }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    qs('prevWeek').addEventListener('click', function () { setWeek(activeWeek() - 1); });
    qs('nextWeek').addEventListener('click', function () { setWeek(activeWeek() + 1); });
    qs('weekTitle').addEventListener('click', openWeekPicker);
    qs('backToNow').addEventListener('click', goToCurrentWeek);
    qs('btnToday').addEventListener('click', goToCurrentWeek);
    qs('btnAdd').addEventListener('click', function () { openEditor(null); });
    qs('btnCourseList').addEventListener('click', openCourseList);
    qs('btnSettings').addEventListener('click', function () { openSettings(false); });
    qs('btnAssignments').addEventListener('click', function () {
      if (window.LumiReminders) window.LumiReminders.open();
    });
    qs('btnAlbum').addEventListener('click', function () {
      if (window.LumiAlbum) window.LumiAlbum.open();
    });
    qs('loveBanner').addEventListener('click', openLoveCard);

    qs('timetable').addEventListener('click', function (event) {
      var card = event.target.closest('.course-card');
      // 直接进编辑：点课程框就改，不用先过一层详情
      if (card) openEditor(card.dataset.courseId);
    });

    qs('courseList').addEventListener('click', function (event) {
      var li = event.target.closest('li');
      if (!li || !li.dataset.courseId) return;
      closeSheet('list');
      openEditor(li.dataset.courseId);
    });

    qs('detailEdit').addEventListener('click', function () {
      if (state.detailId) openEditor(state.detailId);
    });

    qs('courseForm').addEventListener('submit', submitCourse);
    qs('btnDelete').addEventListener('click', deleteCourse);
    qs('settingsForm').addEventListener('submit', submitSettings);
    qs('btnCloseSettings').addEventListener('click', function () {
      closeSheet('settings');
      if (!settings().hasCompletedSetup) openSettings(true);
    });

    qs('btnExport').addEventListener('click', exportBackup);
    bindBackgroundControls();

    qs('carouselTrack').addEventListener('click', function (event) {
      var card = event.target.closest('.carousel-card');
      if (!card || !window.LumiAlbum) return;
      window.LumiAlbum.openAt(Number(card.dataset.index));
    });
    qs('importFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (file) importBackup(file);
      event.target.value = '';
    });

    qs('weekGrid').addEventListener('click', function (event) {
      var cell = event.target.closest('.week-cell');
      if (!cell) return;
      closeSheet('week');
      setWeek(Number(cell.dataset.week));
    });

    document.addEventListener('click', function (event) {
      var closer = event.target.closest('[data-close]');
      if (!closer) return;
      var name = closer.dataset.close;
      if (name === 'settings' && !settings().hasCompletedSetup) {
        closeSheet('settings');
        openSettings(true);
        return;
      }
      closeSheet(name);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeAllSheets();
    });
  }

  /* ---------- 启动 ---------- */

  function tick() {
    renderTop();
    renderGrid();
  }

  function readWeekParam() {
    // ?week=5 直接打开某一周（方便分享与排查，不写入存储）
    var match = /[?&]week=(-?\d+)/.exec(location.search || '');
    if (!match) return null;
    var week = Number(match[1]);
    if (!isFinite(week)) return null;
    return Math.min(Math.max(1, week), settings().totalWeeks);
  }

  function readTabParam() {
    // 主屏幕快捷方式用：?tab=assign|album|settings
    var match = /[?&]tab=(assign|album|settings)/.exec(location.search || '');
    return match ? match[1] : null;
  }

  function openTab(tab) {
    if (tab === 'assign' && window.LumiReminders) window.LumiReminders.open();
    else if (tab === 'album' && window.LumiAlbum) window.LumiAlbum.open();
    else if (tab === 'settings') openSettings(false);
  }

  function start() {
    load();
    bind();
    state.viewWeek = readWeekParam();
    render();

    // 作业 / 上课提醒 与 相册（IndexedDB）
    if (window.LumiReminders) {
      window.LumiReminders.init({
        getData: function () { return state.data; },
        save: save,
        toast: toast,
        openSheet: openSheet,
        closeSheet: closeSheet
      });
    }
    if (window.LumiAlbum) {
      window.LumiAlbum.init({
        getBackgroundId: function () { return settings().backgroundPhotoId; },
        setBackgroundId: function (id) { settings().backgroundPhotoId = id; },
        getBackgroundStyle: bgStyle,
        save: save,
        toast: toast,
        openSheet: openSheet,
        closeSheet: closeSheet,
        onPhotosChanged: function () { renderCarousel(); }
      });
    }
    renderCarousel();

    // ?preview=1 时不弹首次设置，方便截屏/演示；不会改动任何数据
    var preview = /[?&]preview=1/.test(location.search || '');
    if (!settings().hasCompletedSetup && !preview) openSettings(true);

    var deepLinkTab = readTabParam();
    if (deepLinkTab && settings().hasCompletedSetup) {
      setTimeout(function () { openTab(deepLinkTab); }, 350);
    }

    setInterval(tick, 60 * 1000);
    setInterval(function () {
      if (window.LumiReminders) window.LumiReminders.check(new Date());
    }, 30 * 1000);
    setTimeout(function () {
      if (window.LumiReminders) window.LumiReminders.check(new Date());
    }, 1500);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存失败不影响使用 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
