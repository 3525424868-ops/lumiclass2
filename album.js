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
  var onlyFavorites = false;

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
      // 喜欢的排前面（相册与首页轮播都用这个顺序）
      photos = core.sortPhotosForDisplay(items);
      renderGrid();
      applyBackground();
      if (hooks && hooks.onPhotosChanged) hooks.onPhotosChanged(photos);
      return photos.length;
    });
  }

  function visiblePhotos() {
    return onlyFavorites ? photos.filter(function (p) { return p.favorite; }) : photos;
  }

  function renderGrid() {
    var grid = qs('albumGrid');
    grid.textContent = '';
    var list = visiblePhotos();
    qs('albumEmpty').hidden = photos.length > 0;
    var count = photos.length;
    var favs = core.favoriteCount(photos);
    var bytes = photos.reduce(function (sum, p) {
      return sum + (p.full ? p.full.size : 0) + (p.thumb ? p.thumb.size : 0);
    }, 0);
    qs('albumCount').textContent = count
      ? count + ' 张照片 · 约 ' + (bytes / 1024 / 1024).toFixed(1) + ' MB'
      : '还没有照片';
    var favLabel = qs('albumFavCount');
    if (favLabel) favLabel.textContent = favs ? '已收藏 ' + favs + ' 张，会排在前面、首页轮播优先显示' : '点开照片后按「♡ 喜欢」，喜欢的会排在前面';
    var onlyBtn = qs('btnOnlyFav');
    if (onlyBtn) onlyBtn.setAttribute('aria-pressed', onlyFavorites ? 'true' : 'false');

    list.forEach(function (photo) {
      var index = photos.indexOf(photo);
      var button = el('button', 'album-cell');
      button.type = 'button';
      button.dataset.index = String(index);
      var img = el('img');
      img.src = urlFor(photo, 'thumb');
      img.alt = photo.name || ('照片 ' + (index + 1));
      img.loading = 'lazy';
      button.appendChild(img);
      if (photo.favorite) button.appendChild(el('span', 'fav', '♥'));
      grid.appendChild(button);
    });

    if (!list.length && photos.length) {
      grid.appendChild(el('p', 'hint', '还没有喜欢的照片，点开任意一张按「♡ 喜欢」。'));
    }
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

    var favBtn = qs('btnPhotoFavorite');
    if (favBtn) {
      favBtn.textContent = photo.favorite ? '♥ 已喜欢' : '♡ 喜欢';
      favBtn.dataset.fav = photo.favorite ? '1' : '0';
    }
  }

  /** 收藏 / 取消收藏；收藏的会排在相册前面，首页轮播也优先显示 */
  async function toggleFavorite() {
    var photo = photos[viewIndex];
    if (!photo) return;
    var next = Object.assign({}, photo, { favorite: !photo.favorite });
    try {
      await store.put(next);
    } catch (error) {
      hooks.toast('保存失败：' + (error && error.message ? error.message : error));
      return;
    }
    await refresh();
    var index = -1;
    photos.forEach(function (item, i) { if (item.id === next.id) index = i; });
    viewIndex = index >= 0 ? index : 0;
    renderViewer();
    hooks.toast(next.favorite ? '已喜欢：会排在前面，首页轮播优先显示' : '已取消喜欢');
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
    if (!isBackground) {
      // 设好背景后直接回到课表，让用户马上看到效果
      hooks.closeSheet('photo');
      hooks.closeSheet('album');
      hooks.toast('已设为课表背景，去「设置 → 课表背景」调虚实大小');
    } else {
      renderViewer();
      hooks.toast('已恢复粉色背景');
    }
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

  /** 把背景照片铺到页面底层；虚化、亮度、缩放、位置、遮罩都来自设置 */
  async function applyBackground() {
    var layer = qs('photoBg');
    if (!layer) return;
    var style = hooks.getBackgroundStyle ? hooks.getBackgroundStyle() : null;
    if (style) {
      layer.style.setProperty('--bg-blur', style.blur + 'px');
      layer.style.setProperty('--bg-bright', String(style.brightness / 100));
      layer.style.setProperty('--bg-scale', String(style.scale / 100));
      layer.style.setProperty('--bg-origin', style.position + '%');
      layer.style.setProperty('--bg-overlay', String(style.overlay / 100));
    }

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

  /** 导入打包好的内置照片（photos.zip） */
  async function importBuiltin() {
    var bundle = global.LumiPhotoBundle;
    var button = qs('btnImportBuiltin');
    var status = qs('albumImportStatus');
    if (!bundle) { hooks.toast('照片包模块没加载成功'); return; }

    button.disabled = true;
    status.hidden = false;
    status.textContent = '准备导入…';
    try {
      var result = await bundle.importAll({
        onProgress: function (done, total, text) {
          status.textContent = text + (total ? '（' + done + '/' + total + '）' : '');
        }
      });
      await refresh();
      status.textContent = '已导入 ' + result.added + ' 张内置照片' + (result.skipped ? '，跳过已存在 ' + result.skipped + ' 张' : '');
      hooks.toast('内置照片已加入相册');
    } catch (error) {
      status.textContent = '导入失败：' + (error && error.message ? error.message : error);
      hooks.toast('导入内置照片失败');
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    qs('btnPickPhotos').addEventListener('click', function () { qs('albumInput').click(); });
    qs('btnImportBuiltin').addEventListener('click', importBuiltin);
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
    qs('btnPhotoFavorite').addEventListener('click', toggleFavorite);
    qs('btnPhotoBackground').addEventListener('click', toggleBackground);
    qs('btnPhotoDelete').addEventListener('click', removeCurrent);
    qs('btnOnlyFav').addEventListener('click', function () {
      onlyFavorites = !onlyFavorites;
      renderGrid();
    });

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

  function list() { return photos.slice(); }

  function thumbUrl(photo) { return urlFor(photo, 'thumb'); }

  global.LumiAlbum = {
    init: function (options) {
      hooks = options;
      bind();
      refresh().then(function (items) {
        if (hooks.onPhotosChanged) hooks.onPhotosChanged(items);
      }).catch(function () { /* 首次打开可能还没有照片 */ });
    },
    open: open,
    openAt: function (index) { openViewer(index); },
    refresh: refresh,
    list: list,
    thumbUrl: thumbUrl,
    applyBackground: applyBackground,
    addFiles: addFiles,
    importBuiltin: importBuiltin
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
