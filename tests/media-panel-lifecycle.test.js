const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/js/main.js'),'utf8');
function fn(name){const start=source.indexOf('  function '+name+'(');let end=source.indexOf('\n  function ',start+1);return source.slice(start,end);}

test('startup waits for media dependency validation before showing an error',async()=>{
  let rejectReady;
  const notices=[];
  const context={mediaTools:{prepare:()=>new Promise((_resolve,reject)=>{rejectReady=reject;})},showNotice:(...args)=>notices.push(args),friendlyError:error=>error.message};
  vm.createContext(context);vm.runInContext(fn('initializeMediaTools'),context);
  context.initializeMediaTools();
  assert.equal(notices.length,0);
  rejectReady(new Error('reinstall media tools'));await Promise.resolve();
  assert.deepEqual(notices,[['reinstall media tools',true,0]]);
});

test('no decoded video frame triggers proxy; stale playback cannot revive itself',()=>{
  let pending, fallbacks=0, stopped=0;
  const media={getAttribute:()=>null};
  const context={selectionPreview:{token:4,media},setTimeout:f=>(pending=f,1),clearTimeout:()=>{},fallbackSelectedVideoPreview:()=>fallbacks++,stopSelectedVideoPreview:()=>stopped++};
  vm.createContext(context);vm.runInContext(fn('armSelectedVideoFrameWatchdog'),context);
  context.armSelectedVideoFrameWatchdog({},media,4,false);pending();assert.equal(fallbacks,1);
  context.armSelectedVideoFrameWatchdog({},media,3,false);pending();assert.equal(fallbacks,1);
  context.armSelectedVideoFrameWatchdog({},media,4,true);pending();assert.equal(stopped,1);
});

test('closing card playback cancels its proxy and releases its cache lease',()=>{
  const calls=[]; const media={pause:()=>calls.push('pause'),removeAttribute:()=>{},load:()=>{},parentNode:null};
  const context={selectionPreview:{media,assetId:'a',token:1,fallbackRequested:true,cachePath:'/cache/a'},assetForId:()=>({path:'/media/a'}),mediaTools:{cancelPreviewJob:p=>calls.push(p),releaseCacheFile:p=>calls.push(p)},clearTimeout:()=>{}};
  vm.createContext(context);vm.runInContext(fn('stopSelectedVideoPreview'),context);context.stopSelectedVideoPreview();
  assert.deepEqual(calls,['/media/a','/cache/a','pause']);assert.equal(context.selectionPreview.media,null);assert.equal(context.selectionPreview.token,2);
});

test('starting a labelled multi-file drag makes no Adobe calls or imports',()=>{
  const assets=[{domId:'a',path:'/a.mp4',type:'video'},{domId:'b',path:'/b.mp4',type:'video'}];
  const card={getAttribute:()=> 'a',classList:{add:()=>{}}};const data=[];
  const context={closestCard:()=>card,assetForId:()=>assets[0],stopAudioHover:()=>{},nodeAvailable:true,csInterface:{evalScript:()=>{throw Error('host mutation before drop');}},state:{hostId:'PPRO',selectedIds:{a:true,b:true}},selectedAssets:()=>assets,populateAdobeDragData:(_e,p)=>data.push(p),elements:{statusText:{}},localMetaFor:()=>({label:'rose'})};
  vm.createContext(context);vm.runInContext(fn('startAssetDrag'),context);
  context.startAssetDrag({target:{closest:()=>null},dataTransfer:{setData:()=>{}},preventDefault:()=>{throw Error('unexpected rejection');}});
  assert.equal(data[0].join(','),'/a.mp4,/b.mp4');
});
