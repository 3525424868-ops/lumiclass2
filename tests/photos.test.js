/*
 * 内置照片包测试：npm 级依赖为零，直接用 node 跑
 *   node tests/photos.test.js
 * 校验 photos.zip 的存储式 zip 解析、manifest 完整性与尺寸合理性。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bundle = require('../photobundle.js');

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

const zipPath = path.join(__dirname, '..', 'photos.zip');
const zipBytes = fs.readFileSync(zipPath);
const buffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength);

test('photos.zip 存在且小于 25 MB（GitHub 网页上传上限）', () => {
  assert.ok(fs.existsSync(zipPath), 'photos.zip 不存在');
  assert.ok(zipBytes.length < 25 * 1024 * 1024, 'zip 太大了：' + zipBytes.length);
});

const entries = bundle.parseZip(buffer);

test('zip 能解析出 118 张图 + 1 个 manifest', () => {
  assert.strictEqual(entries.size, 119, '实际条目数 ' + entries.size);
  assert.ok(entries.has('photos/manifest.json'));
});

const manifest = JSON.parse(new TextDecoder('utf-8').decode(
  new Uint8Array(buffer, entries.get('photos/manifest.json').offset, entries.get('photos/manifest.json').size)
));

test('manifest 里有 59 张照片', () => {
  assert.strictEqual(manifest.count, 59);
  assert.strictEqual(manifest.photos.length, 59);
});

test('每张照片都有 full / thumb 条目且大小合理', () => {
  manifest.photos.forEach((photo) => {
    const full = entries.get(photo.full);
    const thumb = entries.get(photo.thumb);
    assert.ok(full, '缺少 ' + photo.full);
    assert.ok(thumb, '缺少 ' + photo.thumb);
    assert.ok(full.size > 10 * 1024, photo.full + ' 太小：' + full.size);
    assert.ok(thumb.size > 2 * 1024 && thumb.size < full.size, photo.thumb + ' 缩略图异常：' + thumb.size);
    assert.ok(photo.width <= 1200 && photo.height <= 1200, '尺寸超标：' + photo.width + 'x' + photo.height);
  });
});

test('JPEG 头尾正确（解出来的字节是真图片）', () => {
  const photo = manifest.photos[0];
  const entry = entries.get(photo.full);
  const bytes = new Uint8Array(buffer, entry.offset, entry.size);
  assert.strictEqual(bytes[0], 0xFF);
  assert.strictEqual(bytes[1], 0xD8);
  assert.strictEqual(bytes[entry.size - 2], 0xFF);
  assert.strictEqual(bytes[entry.size - 1], 0xD9);
});

test('照片 id 唯一且 order 连续', () => {
  const ids = new Set(manifest.photos.map((p) => p.id));
  assert.strictEqual(ids.size, manifest.photos.length);
  const orders = manifest.photos.map((p) => p.order).sort((a, b) => a - b);
  assert.strictEqual(orders[0], 1);
  assert.strictEqual(orders[orders.length - 1], manifest.photos.length);
});

if (failures.length) {
  console.error(`\n${passed} 项通过，${failures.length} 项失败：`);
  failures.forEach(({ name, error }) => {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  });
  process.exit(1);
}

const totalMb = (zipBytes.length / 1024 / 1024).toFixed(2);
console.log(`${passed} 项断言全部通过（photos.zip ${totalMb} MB，59 张照片）`);
