'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

async function loadProfile() {
  const source = await fs.readFile(path.resolve(__dirname, '../app/ui/reader/device-profile.js'), 'utf8');
  const document = {
    documentElement: { dataset: {} },
    body: { dataset: {}, classList: { toggle() {} } },
    getElementById() { return null; }
  };
  const context = vm.createContext({
    window: { navigator: {}, innerWidth: 390, innerHeight: 844 },
    document,
    state: { contentType: 'epub' }
  });
  vm.runInContext(source, context);
  return context;
}

test('device profile recognizes Android, iPhone, and iPad desktop mode', async () => {
  const context = await loadProfile();
  const classify = (navigatorObject, width = 390, height = 844) => vm.runInContext(
    `getReaderDeviceProfile({ navigatorObject: ${JSON.stringify(navigatorObject)}, viewportWidth: ${width}, viewportHeight: ${height}, matchMedia: () => ({ matches: false }) })`,
    context
  );

  assert.equal(classify({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux' }).surface, 'mobile');
  assert.equal(classify({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' }).surface, 'mobile');
  assert.equal(classify({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }, 1024, 768).kind, 'ipad');
});

test('device profile keeps narrow desktop windows on the desktop surface', async () => {
  const context = await loadProfile();
  const profile = vm.runInContext(`getReaderDeviceProfile({
    navigatorObject: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10 },
    viewportWidth: 640,
    viewportHeight: 800,
    matchMedia: () => ({ matches: false })
  })`, context);
  assert.equal(profile.surface, 'desktop');
});
