/* Local, synthetic UI fixture only. Hooks are inserted while serving, never shipped. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../extension');
const hooks=`window.lkPerf={state:state,render:renderAssets,filter:applyFilters,open:openOfflinePreview,close:closeOfflinePreview,snapshot:offlineSnapshot,beginSprite:beginSpritePreview,endSprite:endSpritePreview,initFixture:function(count){
var counters={cached:0,generated:0,sprites:0,cancelled:0};
mediaTools={cachedPreviewFor:function(asset,kind){counters.cached++;return Promise.resolve({path:'/fixture.jpg',cached:true,metadata:{duration:6,frameRate:24},sampleTimes:Array.from({length:12},function(_,i){return i/2;})});},posterFor:function(){counters.generated++;return Promise.resolve('/fixture.jpg');},spriteFor:function(){counters.sprites++;return Promise.resolve({path:'/fixture.jpg',sampleTimes:Array.from({length:12},function(_,i){return i/2;})});},metadataFor:function(){return Promise.resolve({duration:6});},setActivity:function(){},cancelBackgroundFor:function(){counters.cancelled++;},getResourceStatus:function(){return {active:0,queued:0};},getStatus:function(){return {state:'ready'};},cacheRoot:'/Synthetic/Cache/com.fnnas.fnosbridge.mvp',cacheStats:function(){return {bytes:1048576,root:this.cacheRoot,layers:{images:{bytes:1048576,maxBytes:1e9},proxies:{bytes:0,maxBytes:2e9}}};}};
SeekLibrary.fileUrl=function(){return '/fixture.jpg';};
var snap={id:'',status:'idle',total:0,done:0,cached:0,failed:0,current:null,failures:[],writable:true,locked:false,options:{metadata:true,posters:true,sprites:false,proxies:false,pin:true,profile:'low',proxyQuality:'540'}};
var listener=function(){},timer=null;function emit(){listener(snap);return Promise.resolve(snap);}function stop(){clearInterval(timer);timer=null;}function tick(){if(snap.status!=='running')return;snap.done++;snap.current={name:'Synthetic '+snap.done+'.mp4'};if(snap.done>=snap.total){snap.status='completed';snap.current=null;stop();}emit();}
offlineJobs={snapshot:function(){return Object.assign({},snap);},subscribe:function(fn){listener=fn;return function(){};},load:function(){return emit();},start:function(assets,options){snap=Object.assign({},snap,{id:'fixture',status:'running',total:assets.length,done:0,options:options});stop();timer=setInterval(tick,80);return emit();},pause:function(){snap.status='paused';stop();return emit();},resume:function(){snap.status='running';stop();timer=setInterval(tick,80);return emit();},cancel:function(){snap.status='cancelled';stop();return emit();},retryFailed:function(){return emit();},dispose:function(){stop();return Promise.resolve();}};
offlineJobs.subscribe(renderOfflinePreview);if(count)state.assets=state.assets.slice(0,count);applyFilters();return counters;}};`;
const server=http.createServer((req,res)=>{
 try{
  const rel=new URL(req.url,'http://localhost').pathname;
  const file=rel==='/fixture.jpg'?path.join(root,'ui/assets/lut-preview-landscape-log.jpg'):path.resolve(root,'.'+decodeURIComponent(rel==='/'?'/index.html':rel));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  let data=fs.readFileSync(file);
  if(file===path.join(root,'js/main.js'))data=Buffer.from(data.toString().replace('  if (document.readyState === "loading")',hooks+'\n  if (document.readyState === "loading")'));
  const type={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.jpg':'image/jpeg'}[path.extname(file)]||'text/plain';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
 }catch(error){res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/index.html?stress=10000'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>process.exit(0)));
