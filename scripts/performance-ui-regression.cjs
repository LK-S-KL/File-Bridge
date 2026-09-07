/* Synthetic frontend checks, paired with performance-ui-server.cjs. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.LKFB_TEST_NODE_MODULES||process.cwd()]}));
const base=process.argv[2];
if(!/^http:\/\/127\.0\.0\.1:\d+/.test(base||''))throw Error('Pass the isolated UI fixture URL');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'lkfb-ui-performance-'));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const errors=[],results=[];
 try{
  const page=await browser.newPage({viewport:{width:736,height:800}});page.on('pageerror',e=>errors.push(e.message));
  for(const count of [1000,3000,10000]){
   await page.goto(base.replace(/stress=\d+/,'stress=10000'));await page.waitForFunction(()=>window.lkPerf&&lkPerf.state.assets.length>0);
   await page.evaluate(count=>{window.perfCounters=lkPerf.initFixture(count)},count);
   const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await page.waitForTimeout(200);
   const metrics=await page.evaluate(async()=>{
    const grid=document.getElementById('assetGrid'),frames=[];let last=performance.now(),samples=0;
    for(let i=0;i<90;i++){
     await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-last);last=now;
     grid.scrollTop=i/89*(grid.scrollHeight-grid.clientHeight);samples=Math.max(samples,document.querySelectorAll('.asset-card').length);
    }
    await new Promise(r=>setTimeout(r,400));
    const frame=frames.slice(5).sort((a,b)=>a-b);
    return {count:lkPerf.state.visibleAssets.length,maxCards:samples,cards:document.querySelectorAll('.asset-card').length,posters:document.querySelectorAll('.asset-card img').length,p95FrameMs:frame[Math.floor(frame.length*.95)],maxFrameMs:Math.max(...frame),counters:perfCounters,last:[...document.querySelectorAll('.asset-name')].pop().textContent,nodes:document.querySelectorAll('*').length};
   });
   assert.equal(metrics.count,count);assert.ok(metrics.maxCards<100);assert.equal(metrics.cards,metrics.posters);assert.equal(metrics.counters.generated,0);assert.equal(metrics.counters.sprites,0);assert.ok(metrics.last.includes(String(count).padStart(5,'0')));
   results.push({cpuThrottle:4,...metrics});await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();
  }
  await page.evaluate(()=>lkPerf.open());
  await page.locator('#offlinePreviewPane').waitFor({state:'visible'});
  for(const width of [300,390,736,1200]){
   await page.setViewportSize({width,height:800});
   const geometry=await page.evaluate(()=>{const pane=document.querySelector('#offlinePreviewPane');return {width:innerWidth,overflow:pane.scrollWidth>pane.clientWidth,controls:[...pane.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,x:r.left,right:r.right}})}});
   assert.equal(geometry.overflow,false);geometry.controls.forEach(c=>assert.ok(c.x>=0&&c.right<=width,JSON.stringify(c)));
   await page.screenshot({path:path.join(output,'offline-'+width+'.png')});results.push(geometry);
  }
  await page.setViewportSize({width:736,height:800});
  await page.locator('#offlineStartButton').click();await page.waitForFunction(()=>lkPerf.snapshot().status==='running');
  await page.locator('#offlinePauseButton').click();await page.waitForFunction(()=>lkPerf.snapshot().status==='paused');
  const count=await page.evaluate(()=>lkPerf.snapshot().done);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>lkPerf.snapshot().done),count);
  await page.screenshot({path:path.join(output,'offline-paused.png')});
  await page.locator('#offlineResumeButton').click();await page.waitForFunction(()=>lkPerf.snapshot().status==='running');
  await page.locator('#offlineCancelButton').click();await page.waitForFunction(()=>lkPerf.snapshot().status==='cancelled');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#offlinePreviewPane').isHidden(),true);
  results.push({test:'cache manager start pause resume cancel escape',passed:true,backend:'synthetic; durable worker separately covered in Node tests'});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({output,results,errors,limits:['CPU throttling affects browser main thread only','Synthetic warm-cache images, not physical low-end hardware or SMB']},null,2));
  console.log(JSON.stringify({output,results,errors},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
