/*
 * 照片存储：用 IndexedDB 保存原图与缩略图（localStorage 只有 5 MB，放不下照片）。
 * 存的是 Blob，读出来用 URL.createObjectURL 显示，避免 base64 膨胀。
 */
(function (global) {
  'use strict';

  var DB_NAME = 'lumiclass-web';
  var DB_VERSION = 1;
  var STORE = 'photos';

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('这个浏览器不支持 IndexedDB')); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function put(record) {
    return tx('readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.put(record);
        request.onsuccess = function () { resolve(record.id); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function get(id) {
    return tx('readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.get(id);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function remove(id) {
    return tx('readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.delete(id);
        request.onsuccess = function () { resolve(true); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function all() {
    return tx('readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var request = store.getAll();
        request.onsuccess = function () {
          var items = (request.result || []).slice().sort(function (a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
          resolve(items);
        };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  /** 用 canvas 缩到最长边 maxSize，返回 JPEG Blob */
  function resizeToBlob(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob); else reject(new Error('图片转换失败'));
          }, 'image/jpeg', quality || 0.85);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这个文件不是可识别的图片'));
      };
      img.src = url;
    });
  }

  global.LumiPhotoStore = {
    all: all,
    get: get,
    put: put,
    remove: remove,
    resizeToBlob: resizeToBlob
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
