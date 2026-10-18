/*
 * 内置照片包：photos.zip 是用「存储（不压缩）」方式打包的，浏览器里自己解析即可，
 * 不需要额外的解压库。解析后把每张照片写进 IndexedDB，之后就能离线看/设为背景。
 */
(function (global) {
  'use strict';

  var ZIP_URL = 'photos.zip';
  var ID_PREFIX = 'builtin-';

  function parseZip(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);

    // 1) 从尾部找 EOCD（0x06054b50），最多回退 64KB
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件');

    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    var entries = new Map();
    var pointer = cdOffset;

    for (var n = 0; n < count; n++) {
      if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('zip 目录损坏（第 ' + n + ' 项）');
      var method = view.getUint16(pointer + 10, true);
      var compressedSize = view.getUint32(pointer + 20, true);
      var nameLength = view.getUint16(pointer + 28, true);
      var extraLength = view.getUint16(pointer + 30, true);
      var commentLength = view.getUint16(pointer + 32, true);
      var localOffset = view.getUint32(pointer + 42, true);
      var name = new TextDecoder('utf-8').decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

      if (method !== 0) throw new Error('zip 里 ' + name + ' 不是存储方式，无法解析');

      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('zip 本地头损坏：' + name);
      var localNameLength = view.getUint16(localOffset + 26, true);
      var localExtraLength = view.getUint16(localOffset + 28, true);
      var dataOffset = localOffset + 30 + localNameLength + localExtraLength;

      entries.set(name, { offset: dataOffset, size: compressedSize });
      pointer += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function readBytes(buffer, entry) {
    return new Uint8Array(buffer, entry.offset, entry.size);
  }

  function readJson(buffer, entries, name) {
    var entry = entries.get(name);
    if (!entry) throw new Error('zip 里缺少 ' + name);
    return JSON.parse(new TextDecoder('utf-8').decode(readBytes(buffer, entry)));
  }

  function importAll(options) {
    var settings = options || {};
    var onProgress = settings.onProgress || function () {};
    var store = global.LumiPhotoStore;

    onProgress(0, 0, '正在下载照片包（约 7 MB）…');

    return fetch(ZIP_URL).then(function (response) {
      if (!response.ok) throw new Error('下载照片包失败：HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (buffer) {
      var entries = parseZip(buffer);
      var manifest = readJson(buffer, entries, 'photos/manifest.json');
      var photos = manifest.photos || [];
      onProgress(0, photos.length, '解包完成，共 ' + photos.length + ' 张');

      return store.all().then(function (existing) {
        var have = new Set(existing.map(function (item) { return item.id; }));
        var chain = Promise.resolve();
        var added = 0;
        var skipped = 0;

        photos.forEach(function (photo, index) {
          chain = chain.then(function () {
            var id = ID_PREFIX + photo.id;
            if (have.has(id)) {
              skipped++;
              onProgress(index + 1, photos.length, '已存在，跳过');
              return null;
            }
            var fullEntry = entries.get(photo.full);
            var thumbEntry = entries.get(photo.thumb);
            if (!fullEntry || !thumbEntry) return null;
            var full = new Blob([buffer.slice(fullEntry.offset, fullEntry.offset + fullEntry.size)], { type: 'image/jpeg' });
            var thumb = new Blob([buffer.slice(thumbEntry.offset, thumbEntry.offset + thumbEntry.size)], { type: 'image/jpeg' });
            return store.put({
              id: id,
              name: '内置照片 ' + photo.order,
              createdAt: photo.order,
              width: photo.width,
              height: photo.height,
              builtin: true,
              full: full,
              thumb: thumb
            }).then(function () {
              added++;
              onProgress(index + 1, photos.length, '正在保存第 ' + (index + 1) + ' 张');
            });
          });
        });

        return chain.then(function () {
          return { added: added, skipped: skipped, total: photos.length };
        });
      });
    });
  }

  global.LumiPhotoBundle = {
    importAll: importAll,
    parseZip: parseZip,
    ID_PREFIX: ID_PREFIX
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LumiPhotoBundle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
