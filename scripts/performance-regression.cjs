/* Isolated media regression. Only generated samples and a temporary cache are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const media = require('../extension/js/media-tools.js');
const project = path.resolve(__dirname, '..');
const binary = path.join(project, 'build/macos-media/darwin-arm64/ffmpeg');
const probe = path.join(project, 'build/macos-media/darwin-arm64/ffprobe');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkfb-performance-regression-'));
const output = process.argv[2] || path.join(temp, 'results.json');
const home = path.join(temp, 'user');
fs.mkdirSync(home);
const jobs = [];
const errors = [];
const services = [];
const clock = () => Number(process.hrtime.bigint()) / 1e6;
const pair = () => Promise.resolve({ok:true,source:'bundled',architecture:'arm64',version:'8.0.3',ffmpeg:binary,ffprobe:probe});
const instrumented = {
  execFile(command, args, options, callback) {
    const timed = command === '/usr/bin/perl' && args[0].endsWith('media-worker.pl') && args[1] !== '--index';
    if (!timed) return cp.execFile(command,args,options,callback);
    const start=clock();
    return cp.execFile('/usr/bin/time',['-l',command,...args],options,(error,stdout,stderr)=>{
      const rss=String(stderr).match(/(\d+)\s+maximum resident set size/);
      const cpu=String(stderr).match(/([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys/);
      jobs.push({wallMs:Math.round(clock()-start),peakMiB:rss?Math.round(Number(rss[1])/1048576*100)/100:null,cpuSeconds:cpu?Number(cpu[2])+Number(cpu[3]):null});
      callback(error,stdout,stderr);
    });
  }
};
function service(extra={}) {
  const value=media.create({fs,path,os:{homedir:()=>home},crypto,childProcess:instrumented,
    extensionRoot:path.join(project,'extension'),resolveMediaTools:pair,
    resourceProfile:'low',cacheSettings:{minimumFreeBytes:0},...extra});
  services.push(value);return value;
}
async function main(){
  assert.ok(fs.existsSync(binary),'Build bundled macOS FFmpeg first');
  const results=[];
  for(const [label,size,duration,hevc] of [['720p','1280x720',6,false],['4K','3840x2160',6,false],['4K-HEVC','3840x2160',6,true],['720p-long','1280x720',120,false]]){
    const source=path.join(temp,label+'.mp4');
    const encoding=hevc?['-c:v','hevc_videotoolbox','-b:v','40M','-tag:v','hvc1']:['-c:v','libx264','-preset','ultrafast','-crf','18','-g','72'];
    cp.execFileSync('/usr/bin/nice',['-n','10',binary,'-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc2=size=${size}:rate=24:duration=${duration}`,...encoding,'-threads','2',source],{timeout:45000});
    const tools=service();
    const meta=await tools.metadataFor(source);
    const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const start=clock(),jobStart=jobs.length;
    const sprite=await tools.spriteFor(source,{purpose:'foreground'});
    const spriteElapsed=clock()-start;
    const metrics=jobs.slice(jobStart);
    assert.ok(fs.statSync(sprite.path).size>0);
    assert.equal(sprite.sampleTimes.length,12);
    assert.ok(sprite.sampleTimes.every(t=>t>=0 && t<meta.duration));
    const poster=await tools.posterFor(source,{purpose:'foreground'});
    assert.ok(fs.statSync(poster).size>0);
    const cold={wallMs:Math.round(spriteElapsed),workers:metrics.length,peakWorkerMiB:Math.max(0,...metrics.map(j=>j.peakMiB||0)),cpuSeconds:metrics.reduce((a,b)=>a+(b.cpuSeconds||0),0)};
    tools.setActivity({hidden:true});
    let sourceAccess=0,spawns=0;
    const offlineFS=Object.create(fs);
    offlineFS.stat=(file,callback)=>{if(file===source){sourceAccess++;return setTimeout(()=>callback(Object.assign(new Error('source offline'),{code:'ENOENT'})),500)}return fs.stat(file,callback)};
    const warm=service({fs:offlineFS,childProcess:{execFile(...args){spawns++;return instrumented.execFile(...args)}},resolveMediaTools:()=>{throw new Error('Cache hits must not resolve or start FFmpeg')}});
    warm.setActivity({hidden:true});
    const times=[];
    for(let i=0;i<30;i++){
      const before=clock();
      const cached=await warm.cachedPreviewFor(source,'sprite');
      const cachedPoster=await warm.cachedPreviewFor(source,'poster');
      assert.equal(cached.path,sprite.path);assert.equal(cachedPoster.path,poster);
      times.push(clock()-before);
    }
    assert.equal(sourceAccess,0,'Warm cache must not consult an offline source');
    assert.equal(spawns,0,'Warm cache must not wait on a media worker');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),sourceHash);
    const firstMs=times[0];times.sort((a,b)=>a-b);
    const resources=tools.getResourceStatus();delete resources.globalLock;
    results.push({label,duration,codec:meta.videoCodecShort,sourceBytes:fs.statSync(source).size,coldSprite:cold,warm:{firstMs,p95Ms:times[Math.floor(times.length*.95)],sourceAccess,spawns},resources});
  }
  const report={date:new Date().toISOString(),host:{platform:process.platform,arch:process.arch},profile:'low',results,
    limits:['Synthetic local H.264/HEVC samples; not real SMB or long-form HEVC','No physical low-end Mac tested','RSS is the maximum worker process residency reported by macOS time, not total Adobe memory','Source access blocked only for warm-cache checks'],errors};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  for(const tools of services){tools.setActivity({hidden:true});if(tools.dispose)await tools.dispose();}
  // Keep the small fixture for reproducibility; no user cache directory is involved.
  console.log('Isolated fixture: '+temp);
});
