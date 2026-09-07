const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/js/main.js'), 'utf8');
function fn(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
}
function context(values, names) {
  const ctx = vm.createContext(Object.assign({ Promise, setTimeout, clearTimeout }, values));
  names.forEach(name => vm.runInContext(fn(name), ctx));
  return ctx;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 12; i += 1) { await Promise.resolve(); } }
function node() {
  const attrs = {};
  const classes = new Set();
  return { attached: true, style: {}, classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) },
    getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value; }, removeAttribute: key => { delete attrs[key]; } };
}

test('poster completion remains subscribed across a virtual window generation change', async () => {
  const pending = deferred(); const installed = []; const thumb = node();
  const ctx = context({ renderGeneration: 2, previewScrolling: false, document: { documentElement: { contains: el => el.attached } },
    mediaTools: { posterFor: () => pending.promise, metadataFor: () => Promise.resolve({ duration: 2 }) },
    installAssetVisual: (_asset, _thumb, file) => { if (thumb.attached) installed.push(file); }, updateCardMediaBadge: () => {}, syncPreviewDock: () => {} }, ['generateVisual']);
  const request = ctx.generateVisual({ path: '/a.mov', name: 'a', type: 'video' }, thumb, 1);
  pending.resolve('/poster.jpg'); await request;
  assert.deepEqual(installed, ['/poster.jpg']);
});

test('cached poster and metadata are read while the generation queue is occupied', async () => {
  const installed = []; const thumb = node(); let queued = 0;
  const ctx = context({ document: { documentElement: { contains: el => el.attached } },
    cachedPreview: (_asset, kind) => Promise.resolve(kind === 'poster' ? { path: '/cached.jpg' } : { metadata: { duration: 3 } }),
    installAssetVisual: (...args) => installed.push(args), updateCardMediaBadge: () => {}, enqueuePreview: () => { queued += 1; } }, ['startVisualRequest']);
  const asset = { type: 'video', path: '/offline.mov', offline: true };
  ctx.startVisualRequest(asset, thumb, 1); await flush();
  assert.equal(installed[0][2], '/cached.jpg'); assert.equal(queued, 0); assert.equal(asset.mediaMetadata.duration, 3);
});

test('offscreen generation releases its UI slot without waiting for the old promise', async () => {
  const stale = deferred(); const fresh = deferred(); const oldTarget = node(); const newTarget = node(); const calls = [];
  const ctx = context({ previewQueue: [], runningPreviewJobs: [], activePreviewJobs: 0, previewScrolling: false,
    spriteHover: { card: null }, document: { hidden: false, documentElement: { contains: el => el.attached } },
    mediaTools: { cancelBackgroundFor: p => calls.push('cancel:' + p) } }, ['enqueuePreview', 'pumpPreviewQueue', 'previewJobDone', 'cancelInvisiblePreviews']);
  ctx.enqueuePreview(() => { calls.push('old'); return stale.promise; }, { path: '/old' }, oldTarget);
  ctx.enqueuePreview(() => { calls.push('new'); return fresh.promise; }, { path: '/new' }, newTarget);
  assert.deepEqual(calls, ['old']);
  oldTarget.attached = false; ctx.cancelInvisiblePreviews();
  assert.ok(calls.includes('new')); assert.ok(calls.includes('cancel:/old')); assert.equal(ctx.activePreviewJobs, 1);
  stale.resolve(); await flush(); assert.equal(ctx.activePreviewJobs, 1, 'stale completion must not release the new slot');
  fresh.resolve(); await flush(); assert.equal(ctx.activePreviewJobs, 0);
});

test('scrolling pauses generation but keeps queued visible work available to resume', async () => {
  let starts = 0;
  const ctx = context({ previewQueue: [], runningPreviewJobs: [], activePreviewJobs: 0, previewScrolling: true,
    document: { hidden: false, documentElement: { contains: () => true } } }, ['enqueuePreview', 'pumpPreviewQueue', 'previewJobDone']);
  ctx.enqueuePreview(() => { starts += 1; }, { path: '/a' }, node()); assert.equal(starts, 0);
  ctx.previewScrolling = false; ctx.pumpPreviewQueue(); await flush(); assert.equal(starts, 1);
});

test('hover waits 300ms and leaving prevents a late sprite from enabling scrubbing', async () => {
  const thumb = node(); const sprite = node(); const card = node(); const pending = deferred(); let timer; let delay; let starts = 0; const cancelled = [];
  card.contains = () => false; card.getAttribute = () => 'a';
  thumb.querySelector = () => sprite; card.querySelector = selector => selector === '.asset-thumb' ? thumb : sprite;
  const ctx = context({ spriteHover: { token: 0, timer: null, card: null, asset: null }, runningPreviewJobs: [], previewScrolling: false,
    setTimeout: (fn, ms) => { timer = fn; delay = ms; return 1; }, clearTimeout: () => {},
    closestCard: () => card, assetForId: () => ({ domId: 'a', path: '/a', type: 'video' }), stopAudioHover: () => {},
    document: { documentElement: { contains: () => true } }, cachedPreview: () => Promise.resolve(null),
    mediaTools: { spriteFor: () => { starts += 1; return pending.promise; }, cancelBackgroundFor: path => cancelled.push(path) },
    SeekLibrary: { fileUrl: p => p } }, ['beginSpritePreview', 'stopSpriteHover', 'endSpritePreview']);
  ctx.beginSpritePreview({ target: card }); assert.equal(delay, 300); assert.equal(starts, 0);
  timer(); await flush(); assert.equal(starts, 1);
  ctx.endSpritePreview({ target: card }); pending.resolve({ path: '/sprite.jpg' }); await flush();
  assert.equal(thumb.classList.contains('is-scrubbing'), false); assert.equal(sprite.getAttribute('data-ready'), undefined);
  assert.deepEqual(cancelled, ['/a']);
});

test('explicit offline preparation validates cache hits and forwards cancellation to every producer', async () => {
  const calls = []; const signal = { cancelled: false };
  const ctx = context({ cachedPreview: () => Promise.resolve({ path: '/cached.jpg' }), mediaTools: {
    metadataFor: (_path, opts) => { calls.push(['metadata', opts]); return Promise.resolve({}); },
    posterFor: (_path, opts) => { calls.push(['poster', opts]); return Promise.resolve('/poster'); },
    spriteFor: (_path, opts) => { calls.push(['sprite', opts]); return Promise.resolve('/sprite'); },
    pinCachedAsset: (_path, pin) => { calls.push(['pin', pin]); return Promise.resolve(); }
  } }, ['processOfflineAsset']);
  await ctx.processOfflineAsset({ path: '/a', type: 'video' }, { metadata: true, posters: true, sprites: true, pin: true, profile: 'low' }, signal);
  assert.deepEqual(calls.map(call => call[0]), ['metadata', 'poster', 'sprite', 'pin']);
  assert.ok(calls.slice(0, 3).every(call => call[1].signal === signal && call[1].purpose === 'offline'));
  signal.cancelled = true;
  await assert.rejects(ctx.processOfflineAsset({ path: '/a', type: 'video' }, { metadata: true }, signal), { code: 'JOB_CANCELLED' });
});

test('proxy selection searches cached small variants before original playback', async () => {
  const qualities = [];
  const ctx = context({ mediaTools: { cachedPreviewFor: (_path, _kind, quality) => { qualities.push(quality); return Promise.resolve(quality === '720' ? { path: '/720.mp4' } : null); } } }, ['cachedPreview']);
  const result = await ctx.cachedPreview({ path: '/source.mp4' }, 'proxy');
  assert.equal(result.path, '/720.mp4'); assert.deepEqual(qualities, ['540', '720']);
});

test('cache configuration cannot replace a busy service or survive a failed preference write', async () => {
  let writes = 0; let replacements = 0; let disposed = 0; let busy = true;
  const original = { getResourceStatus: () => ({ active: busy ? 1 : 0, queued: 0 }) };
  const preferences = { previewCacheRoot: '', previewCacheMaxGiB: 12, previewPerformance: 'low' };
  const ctx = context({ state: { preferences }, stateStore: {}, mediaTools: original, activePreviewJobs: 0, previewQueue: [],
    elements: { offlineBudget: { value: '20' }, offlineCacheRoot: { getAttribute: () => '/local-cache' }, offlinePerformance: { value: 'balanced' } },
    persistState: () => { writes += 1; return null; }, createConfiguredMediaTools: () => { replacements += 1; return { dispose: () => { disposed++; return Promise.resolve(); } }; } }, ['saveOfflineConfiguration']);
  await assert.rejects(ctx.saveOfflineConfiguration(), /预览仍在处理/); assert.equal(writes, 0);
  busy = false;
  await assert.rejects(ctx.saveOfflineConfiguration(), /缓存设置未保存/);
  assert.equal(writes, 1); assert.equal(replacements, 1); assert.equal(disposed, 1); assert.equal(ctx.mediaTools, original); assert.equal(ctx.state.preferences, preferences);
});

test('invalid cache directories never persist broken settings', async () => {
  let writes = 0;
  const ctx = context({ state: { preferences: { previewCacheMaxGiB: 12 } }, mediaTools: null, activePreviewJobs: 0, previewQueue: [],
    elements: { offlineBudget: { value: '20' }, offlineCacheRoot: { getAttribute: () => '/read-only' }, offlinePerformance: { value: 'low' } },
    persistState: () => { writes++; }, createConfiguredMediaTools: () => { throw Error('EACCES'); } }, ['saveOfflineConfiguration']);
  await assert.rejects(ctx.saveOfflineConfiguration(), /原设置保持不变/); assert.equal(writes, 0);
});

test('low profile routes expensive selected media to a small proxy, not original decode', () => {
  const ctx = context({ state: { preferences: { previewPerformance: 'low' } } }, ['selectedPreviewNeedsProxy', 'selectedPreviewProfile']);
  assert.equal(ctx.selectedPreviewProfile({}), '540');
  for (const metadata of [{width:3840}, {height:2160}, {frameRate:60}, {totalBitrate:80000000}, {videoCodecShort:'hevc'}]) {
    assert.equal(ctx.selectedPreviewNeedsProxy({mediaMetadata:metadata}), true);
  }
  assert.equal(ctx.selectedPreviewNeedsProxy({mediaMetadata:{width:1920,height:1080,frameRate:24,totalBitrate:8000000,videoCodecShort:'h264'}}), false);
});

test('offline originals are rejected before Adobe import or viewer drag', async () => {
  let rejectedDrag = 0;
  const asset = { path: '/offline.mov', type: 'video', offline: true };
  const ctx = context({ state: { hostId: 'PPRO' }, viewerState: { asset },
    FnOSInteractionTools: { viewerDragPath: () => { throw Error('offline drag escaped'); } } }, ['runHostActionForAssets', 'startViewerDrag']);
  await assert.rejects(ctx.runHostActionForAssets([asset], false), /离线/);
  ctx.startViewerDrag({ preventDefault: () => { rejectedDrag += 1; } }); assert.equal(rejectedDrag, 1);
});
