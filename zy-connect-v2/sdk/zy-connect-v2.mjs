/**
 * ZY-Connect v2 local SDK (Node 20+).
 * Zero-copy: queues JSON references only; never stages/copies video bytes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEDIA = ['videoPath','coverPath','portraitCoverPath','landscapeCoverPath'];
const FIELDS = new Set(['contentId','videoPath','title','description','hashtags',
  'coverPath','portraitCoverPath','landscapeCoverPath','collectionName','publishAt','metadata']);
function local(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) ||
      u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
    throw new Error('v2 gateway must be localhost HTTP');
  }
  return u.origin;
}
function within(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
async function read(file) {
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function write(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + crypto.randomUUID();
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.promises.rename(tmp, file);
  } catch (e) { await fs.promises.rm(tmp, { force: true }); throw e; }
}
async function request(fetchImpl, url, { method = 'GET', body, token, discovery = false } = {}) {
  const headers = { ...(discovery ? { 'x-zy-connect-intent': 'v2' } : {}) };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const response = await fetchImpl(url, { method, headers,
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
export class ZyConnectV2 {
  constructor({ name, outputDir, gatewayUrl = 'http://127.0.0.1:17351',
    stateDir = null, fetchImpl = fetch }) {
    if (typeof name !== 'string' || !name.trim() || !outputDir) throw new Error('name and producer outputDir are required');
    this.name = name.trim();
    this.outputDir = path.resolve(outputDir);
    this.gatewayUrl = local(gatewayUrl);
    this.fetch = fetchImpl;
    this.stateDir = path.resolve(stateDir || path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
      'Zhiyan','ConnectV2',digest(this.outputDir + ':' + this.name).slice(0,24),
    ));
    this.credentialFile = path.join(this.stateDir,'connection.json');
    this.approvalFile = path.join(this.stateDir,'approval.json');
    this.queueDir = path.join(this.stateDir,'queue');
    this.flushTask = null;
    this.timer = null;
  }
  async status() {
    const auth = await read(this.credentialFile);
    const rows = await this._rows();
    return { connected: Boolean(auth?.token), awaitingApproval: Boolean(await read(this.approvalFile)),
      pending: rows.filter(x=>x.state==='pending').length,
      blocked: rows.filter(x=>x.state==='blocked').length,
      acknowledged: rows.filter(x=>x.state==='acknowledged').length };
  }
  async requestConnection({ capabilities = ['video_path','metadata','receipt'] } = {}) {
    const auth = await read(this.credentialFile);
    if (auth?.token) return { status: 'connected', connectionId: auth.connectionId };
    const waiting = await read(this.approvalFile);
    if (waiting && Date.parse(waiting.expiresAt)>Date.now()) return {status:'pending',requestId:waiting.requestId};
    const {status,data} = await request(this.fetch,this.gatewayUrl+'/v2/connect-requests',{
      method:'POST',discovery:true,
      body:{name:this.name,outputDir:this.outputDir,capabilities},
    });
    if(status!==202 || !data.requestSecret) throw new Error('connection request failed HTTP '+status);
    await write(this.approvalFile,data);
    return {status:'pending',requestId:data.requestId,expiresAt:data.expiresAt};
  }
  async checkApproval() {
    const waiting = await read(this.approvalFile);
    if(!waiting) return {status:(await read(this.credentialFile))?.token?'connected':'not_requested'};
    const {status,data} = await request(this.fetch,this.gatewayUrl+
      '/v2/connect-requests/'+encodeURIComponent(waiting.requestId)+'/claim',{
      token:waiting.requestSecret });
    if(status===200 && data.status==='pending') return {status:'pending'};
    if(status===200 && data.status==='approved' && data.credential?.token && data.connectionId) {
      await write(this.credentialFile,{
        connectionId:data.connectionId,token:data.credential.token,gatewayUrl:this.gatewayUrl });
      await fs.promises.rm(this.approvalFile,{force:true});
      return {status:'connected',connectionId:data.connectionId};
    }
    if(status===401 || Date.parse(waiting.expiresAt)<Date.now()) {
      await fs.promises.rm(this.approvalFile,{force:true});return {status:'expired'};
    }
    throw new Error('approval query failed HTTP '+status);
  }
  async waitForApproval({timeoutMs=600000,intervalMs=1500}={}) {
    const until=Date.now()+timeoutMs;
    while(Date.now()<until){const r=await this.checkApproval();if(['connected','expired'].includes(r.status))return r;await sleep(intervalMs);}
    return {status:'timeout'};
  }
  _file(id){return path.join(this.queueDir,digest(id)+'.json');}
  async _rows() {
    const names=await fs.promises.readdir(this.queueDir).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));
    return Promise.all(names.filter(n=>n.endsWith('.json')).map(n=>read(path.join(this.queueDir,n))));
  }
  async _validated(data) {
    if(!data || typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!FIELDS.has(k)))
      throw new Error('unsupported delivery fields');
    if(typeof data.contentId!=='string'||!data.contentId.trim()||data.contentId.length>256)
      throw new Error('stable contentId required');
    if(typeof data.title!=='string'||!data.title.trim())throw new Error('real title required');
    const root=await fs.promises.realpath(this.outputDir);
    const payload={...data,contentId:data.contentId.trim()};
    for(const key of MEDIA){
      if(!data[key]){if(key==='videoPath')throw new Error('videoPath required');continue;}
      const candidate=path.resolve(data[key]);
      const st=await fs.promises.lstat(candidate);
      const real=await fs.promises.realpath(candidate);
      if(!st.isFile()||st.isSymbolicLink()||!within(real,root))throw new Error('media outside producer directory');
      payload[key]=real;
    }
    return payload;
  }
  async deliver(input) {
    const id=typeof input?.contentId==='string'?input.contentId.trim():'';
    const previous=id?await read(this._file(id)):null;
    if(previous)return this._visible(previous);
    const payload=await this._validated(input);
    const row={contentId:payload.contentId,payload,state:'pending',attempts:0,nextRetryAt:null,lastError:null,deliveryId:null};
    await write(this._file(row.contentId),row); // JSON reference only, no media copies
    await this.flush();
    return this._visible(await read(this._file(row.contentId)));
  }
  _visible(x){return {contentId:x.contentId,state:x.state,deliveryId:x.deliveryId,lastError:x.lastError};}
  async flush() {
    if(this.flushTask)return this.flushTask;
    this.flushTask=(async()=>{
      const auth=await read(this.credentialFile);
      if(!auth?.token||!auth.connectionId)return [];
      const sent=[];
      for(const row of await this._rows()){
        if(row.state!=='pending'||(row.nextRetryAt&&Date.parse(row.nextRetryAt)>Date.now()))continue;
        row.attempts++;
        try{
          row.payload=await this._validated(row.payload);
          const r=await request(this.fetch,this.gatewayUrl+'/v2/connections/'+
            encodeURIComponent(auth.connectionId)+'/deliveries',{
            method:'POST',token:auth.token,body:row.payload});
          if(r.status===202&&r.data.accepted&&r.data.delivery?.id){
            row.state='acknowledged';row.deliveryId=r.data.delivery.id;row.lastError=null;
          } else if([401,403,410].includes(r.status)){
            // Permission was revoked or the connection was removed. Forget the
            // local token, retain the metadata safely and require re-approval.
            await fs.promises.rm(this.credentialFile,{force:true});
            row.state='blocked';row.lastError='connection authorization revoked; reconnect in Zhiyan';
          } else if(r.status>=400&&r.status<500&&![408,425,429].includes(r.status)){
            row.state='blocked';row.lastError='gateway rejected HTTP '+r.status;
          } else throw new Error('temporary gateway HTTP '+r.status);
        }catch(e){
          row.lastError=String(e.message||e).slice(0,220);
          row.nextRetryAt=new Date(Date.now()+Math.min(300000,2000*2**Math.min(7,row.attempts))).toISOString();
        }
        await write(this._file(row.contentId),row);sent.push(this._visible(row));
      }
      return sent;
    })();
    try{return await this.flushTask;}finally{this.flushTask=null;}
  }
  startRetry({intervalMs=5000}={}) {
    if(this.timer)return;
    this.timer=setInterval(()=>{void this.flush().catch(()=>{});},Math.max(1000,intervalMs));
    this.timer.unref?.();void this.flush().catch(()=>{});
  }
  stopRetry(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}