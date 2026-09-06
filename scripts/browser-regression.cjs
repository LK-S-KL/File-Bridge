/* Isolated UI integration tests. No user state or Adobe project is accessed. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(require.resolve('playwright', {paths:[process.env.LKFB_TEST_NODE_MODULES || process.cwd()]}));
const root = path.resolve(__dirname,'../extension');
const output = fs.mkdtempSync(path.join(os.tmpdir(),'lkfb-ui-regression-'));
const hooks = `window.lkTest={state:state, viewer:viewerState, select:selectAsset, filter:applyFilters, render:renderAssets, open:openViewer, close:closeViewer, drag:startAssetDrag, updateMeta:updateLocalMetaBatch, injectStore:function(s){stateStore=s;}, injectTools:function(t){mediaTools=t;}, beginPackage:beginPackageOperation, finishPackage:finishPackageOperation};`;
const errors=[];
const results=[];
const server = http.createServer((req,res)=>{
  const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const p=rel==='/fixture.mp4' ? path.join(output,'fixture.mp4') : path.join(root,rel==='/'?'index.html':rel);
  if(!p.startsWith(root+path.sep) && p!==path.join(output,'fixture.mp4')){res.writeHead(403).end();return;}
  try {
    let data=fs.readFileSync(p);
    if(p.endsWith('/js/main.js')) data=Buffer.from(data.toString().replace('  if (document.readyState === "loading")',hooks+'\n  if (document.readyState === "loading")'));
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.mp4':'video/mp4','.jpg':'image/jpeg'};
    res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});res.end(data);
  }catch(e){res.writeHead(404).end();}
});
(async()=>{
  execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=25:duration=8','-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',path.join(output,'fixture.mp4')]);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page=await browser.newPage({viewport:{width:736,height:800}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/index.html?stress=10000');
    await page.waitForFunction(()=>window.lkTest && document.querySelectorAll('.asset-card').length>0);
    const initial=await page.evaluate(()=>({count:lkTest.state.visibleAssets.length,cards:document.querySelectorAll('.asset-card').length,nodes:document.querySelectorAll('*').length}));
    results.push(await page.evaluate(()=>{const start=performance.now();lkTest.filter();return {test:'10k filter and render',ms:performance.now()-start};}));
    assert.equal(initial.count,10000);assert.ok(initial.cards<150);results.push({test:'10k bounded render',...initial});
    await page.evaluate(()=>{const grid=document.querySelector('#assetGrid');grid.scrollTop=grid.scrollHeight;});
    await page.waitForFunction(()=>[...document.querySelectorAll('.asset-name')].some(e=>e.textContent.includes('10000')));
    results.push({test:'last result accessible',passed:true});
    await page.locator('#searchInput').fill('09999');
    await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
    assert.ok(await page.locator('.asset-name').textContent().then(t=>t.includes('09999')));
    await page.locator('#clearSearchButton').click();
    await page.waitForFunction(()=>lkTest.state.visibleAssets.length===10000);
    const bulk=await page.evaluate(()=>{
      let writes=0;const snapshot={assetMeta:{}};
      lkTest.injectStore({mutate:fn=>{writes++;fn(snapshot);return snapshot;}});
      const start=performance.now();lkTest.updateMeta(lkTest.state.assets.slice(0,1000),{favorite:true});
      lkTest.injectStore(null);return {writes,ms:performance.now()-start,count:Object.keys(snapshot.assetMeta).length};
    });
    assert.equal(bulk.writes,1);assert.equal(bulk.count,1000);results.push({test:'1000 metadata one transaction',...bulk});
    for(const width of [300,320,390,736,1200]){
      await page.setViewportSize({width,height:800});await page.waitForTimeout(80);
      const geometry=await page.evaluate(()=>{const ids=['resultActionsButton','selectAllButton','locationsToolbarButton'];return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,buttons:ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,left:r.left,right:r.right};})};});
      assert.equal(geometry.overflow,false);geometry.buttons.forEach(b=>assert.ok(b.left>=0 && b.right<=width));results.push(geometry);
    }
    await page.setViewportSize({width:736,height:800});
    await page.locator('#listModeButton').click();assert.equal(await page.locator('#cardStyleButton').isDisabled(),true);
    assert.equal(await page.locator('.asset-copy').first().isVisible(),true);
    await page.locator('#viewModeButton').click();
    await page.evaluate(()=>{lkTest.select(lkTest.state.assets[0].domId,{only:true});});
    assert.equal(await page.locator('.asset-select-check').first().isVisible(),false);
    await page.locator('#selectAllButton').click();assert.equal(await page.locator('.asset-select-check').first().isVisible(),true);
    await page.locator('#selectAllButton').click();
    await page.screenshot({path:path.join(output,'library-736.png')});
    // Real decoded video through production player event handlers.
    await page.evaluate(base=>{SeekLibrary.fileUrl=()=>base+'/fixture.mp4';lkTest.open(lkTest.state.assets[0]);},base);
    await page.waitForFunction(()=>lkTest.viewer.media.videoWidth===640);
    await page.evaluate(()=>{lkTest.viewer.media.pause();lkTest.viewer.media.currentTime=2;});
    await page.locator('#speedButton').click();await page.locator('[data-speed="1.5"]').click();
    assert.equal(await page.evaluate(()=>lkTest.viewer.media.playbackRate),1.5);
    await page.locator('#qualityButton').click();await page.locator('[data-quality="source"]').click();
    await page.waitForFunction(()=>lkTest.viewer.media.readyState>=2);
    assert.equal(await page.evaluate(()=>lkTest.viewer.media.paused),true);
    await page.locator('#volumeRange').fill('0');await page.locator('#volumeRange').dispatchEvent('input');await page.locator('#volumeButton').click();
    assert.ok(await page.evaluate(()=>lkTest.viewer.media.volume>0 && !lkTest.viewer.media.muted));
    await page.locator('#speedButton').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('#viewer').isVisible(),true);assert.equal(await page.locator('#viewerSpeedMenu').isVisible(),false);
    for(const width of [300,360,736]){
      await page.setViewportSize({width,height:800});await page.waitForTimeout(80);
      const data=await page.evaluate(()=>['volumeButton','volumeRange','screenshotButton','qualityButton','speedButton'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,right:r.right,width:r.width};}));
      data.forEach(x=>assert.ok(x.x>=0 && x.right<=width,JSON.stringify(x)));
      await page.screenshot({path:path.join(output,'player-'+width+'.png')});
    }
    results.push({test:'real video controls, speed, mute, resolution pause preservation',passed:true});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({output,results,errors},null,2));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
