/*
 * 相册：照片存在 IndexedDB（原图 + 缩略图），可看大图、左右翻页、设为课表背景、删除。
 */
(function (global) {
  'use strict';

  var core = global.LumiCore;
  var store = global.LumiPhotoStore;
  var hooks = null;
  var photos = [];
  var urls = new Map();       // id -> { full: url, thumb: url }
  var viewIndex = 0;

  function qs(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function urlFor(photo, kind) {
    var entry = urls.get(photo.id) || {};
    if (!entry[kind]) {
      var blob = kind === 'thumb' ? (photo.thumb || photo.full) : photo.full;
      entry[kind] = URL.createObjectURL(blob);
      urls.set(photo.id, entry);
    }
    return entry[kind];
  }

  function releaseUrls(id) {
    var entry = urls.get(id);
    if (!entry) return;
    Object.keys(entry).forEach(function (key) { URL.revokeObjectURL(entry[key]); });
    urls.delete(id);
  }

  function refresh() {
    return store.all().then(function (items) {
      photos = items;
      renderGrid();
      applyBackground();
      return items.length;
    });
  }

  function renderGrid() {
    var grid = qs('albumGrid');
    grid.textContent = '';
    qs('albumEmpty').hidden = photos.length > 0;
    var count = photos.length;
    var bytes = photos.reduce(function (sum, p) {
      return sum + (p.full ? p.full.size : 0) + (p.thumb ? p.thumb.size : 0);
    }, 0);
    qs('albumCount').textContent = count
      ? count + ' 张照片 · 约 ' + (bytes / 1024 / 1024).toFixed(1) + ' MB'
      : '还没有照片';

    photos.forEach(function (photo, index) {
      var button = el('button', 'album-cell');
      button.type = 'button';
      button.dataset.index = String(index);
      var img = el('img');
      img.src = urlFor(photo, 'thumb');
      img.alt = photo.name || ('照片 ' + (index + 1));
      img.loading = 'lazy';
      button.appendChild(img);
      grid.appendChild(button);
    });
  }

  function open() {
    // 先把弹层打开（立即响应用户），照片随后异步加载进来
    hooks.openSheet('album');
    refresh().catch(function (error) {
      hooks.toast('相册读取失败：' + error.message);
    });
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      return file && /^image\//.test(file.type);
    });
    if (!files.length) { hooks.toast('请选择图片文件'); return; }
    hooks.toast('正在处理 ' + files.length + ' 张照片…');
    var added = 0;
    var failed = 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var full = await store.resizeToBlob(file, 1600, 0.86);
        var thumb = await store.resizeToBlob(full, 400, 0.8);
        await store.put({
          id: core.uid(),
          name: file.name || '',
          createdAt: Date.now(),
          full: full,
          thumb: thumb
        });
        added++;
      } catch (error) {
        failed++;
      }
    }
    await refresh();
    hooks.toast('已添加 ' + added + ' 张' + (failed ? '，失败 ' + failed + ' 张' : ''));
  }

  /* ---------- 大图 ---------- */

  function openViewer(index) {
    viewIndex = Math.max(0, Math.min(index, photos.length - 1));
    renderViewer();
    hooks.openSheet('photo');
  }

  function renderViewer() {
    var photo = photos[viewIndex];
    if (!photo) return;
    var img = qs('photoImage');
    img.src = urlFor(photo, 'full');
    img.alt = photo.name || '照片';
    qs('photoCounter').textContent = (viewIndex + 1) + ' / ' + photos.length;
    qs('photoPrev').disabled = viewIndex <= 0;
    qs('photoNext').disabled = viewIndex >= photos.length - 1;
    var isBackground = hooks.getBackgroundId() === photo.id;
    var btn = qs('btnPhotoBackground');
    btn.textContent = isBackground ? '取消课表背景' : '设为课表背景';
    btn.dataset.active = isBackground ? '1' : '0';
  }

  function step(delta) {
    var next = viewIndex + delta;
    if (next < 0 || next >= photos.length) return;
    viewIndex = next;
    renderViewer();
  }

  async function toggleBackground() {
    var photo = photos[viewIndex];
    if (!photo) return;
    var isBackground = hooks.getBackgroundId() === photo.id;
    hooks.setBackgroundId(isBackground ? null : photo.id);
    hooks.save();
    await applyBackground();
    renderViewer();
    hooks.toast(isBackground ? '已恢复粉色背景' : '已设为课表背景');
  }

  async function removeCurrent() {
    var photo = photos[viewIndex];
    if (!photo) return;
    if (!global.confirm('删除这张照片？删除后无法恢复。')) return;
    if (hooks.getBackgroundId() === photo.id) {
      hooks.setBackgroundId(null);
      hooks.save();
    }
    await store.remove(photo.id);
    releaseUrls(photo.id);
    await refresh();
    if (!photos.length) { hooks.closeSheet('photo'); return; }
    viewIndex = Math.min(viewIndex, photos.length - 1);
    renderViewer();
  }

  /** 把背景照片铺到页面底层；没有照片时恢复粉色渐变 */
  async function applyBackground() {
    var layer = qs('photoBg');
    if (!layer) return;
    var id = hooks.getBackgroundId();
    if (!id) {
      layer.style.backgroundImage = '';
      layer.classList.remove('active');
      document.body.classList.remove('has-photo-bg');
      return;
    }
    try {
      var photo = await store.get(id);
      if (!photo) {
        hooks.setBackgroundId(null);
        hooks.save();
        layer.style.backgroundImage = '';
        layer.classList.remove('active');
        document.body.classList.remove('has-photo-bg');
        return;
      }
      layer.style.backgroundImage = 'url("' + urlFor(photo, 'full') + '")';
      layer.classList.add('active');
      document.body.classList.add('has-photo-bg');
    } catch (error) {
      hooks.toast('背景照片读取失败');
    }
  }

  function bind() {
    qs('btnPickPhotos').addEventListener('click', function () { qs('albumInput').click(); });
    qs('albumInput').addEventListener('change', function (event) {
      var files = event.target.files;
      addFiles(files);
      event.target.value = '';
    });
    qs('albumGrid').addEventListener('click', function (event) {
      var cell = event.target.closest('.album-cell');
      if (!cell) return;
      openViewer(Number(cell.dataset.index));
    });
    qs('photoPrev').addEventListener('click', function () { step(-1); });
    qs('photoNext').addEventListener('click', function () { step(1); });
    qs('btnPhotoBackground').addEventListener('click', toggleBackground);
    qs('btnPhotoDelete').addEventListener('click', removeCurrent);

    // 手机上左右滑动翻页
    var startX = null;
    qs('photoImage').addEventListener('touchstart', function (event) {
      startX = event.touches[0].clientX;
    }, { passive: true });
    qs('photoImage').addEventListener('touchend', function (event) {
      if (startX === null) return;
      var delta = event.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(delta) > 50) step(delta > 0 ? -1 : 1);
    }, { passive: true });
  }

  global.LumiAlbum = {
    init: function (options) {
      hooks = options;
      bind();
      refresh().catch(function () { /* 首次打开可能还没有照片 */ });
    },
    open: open,
    refresh: refresh,
    applyBackground: applyBackground,
    addFiles: addFiles
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
