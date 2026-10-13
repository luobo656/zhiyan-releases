/**
 * ZY-Connect v1 portable local API SDK (Node 20+; no third-party dependencies).
 * Intended to be published separately from the private Zhiyan application.
 * Only sends to a loopback gateway; never logs pairing codes or credentials.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MEDIA_KEYS = ['videoPath', 'coverPath', 'portraitCoverPath', 'landscapeCoverPath'];
const FIELDS = new Set(['contentId', ...MEDIA_KEYS, 'title', 'description', 'hashtags', 'collectionName', 'publishAt', 'metadata']);
const now = () => new Date().toISOString();
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function localGateway(value) {
  const url = new URL(value || 'http://127.0.0.1:17351');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new Error('ZY-Connect v1 only allows local loopback gateway URLs');
  }
  return url.origin;
}
async function writeAtomic(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + crypto.randomUUID();
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
async function jsonFetch(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, data };
}
function exposed(row) {
  return {
    contentId: row.contentId, state: row.state, deliveryId: row.deliveryId || null,
    lastError: row.lastError || null, attemptCount: row.attemptCount || 0,
  };
}
function childOf(parent, file) {
  const relative = path.relative(parent, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export class ZyConnect {
  constructor({ outputDir, gatewayUrl = 'http://127.0.0.1:17351',
    stateDir = null, fetchImpl = fetch } = {}) {
    if (!outputDir) throw new Error('outputDir is required');
    this.outputDir = path.resolve(outputDir);
    this.gatewayUrl = localGateway(gatewayUrl);
    this.fetch = fetchImpl;
    // Never place long-lived authentication tokens in an export directory
    // that may be uploaded or synchronized by the producer.
    const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
    this.stateDir = path.resolve(stateDir || path.join(
      localData, 'Zhiyan', 'ZyConnect', 'node', digest(this.outputDir.toLowerCase()).slice(0, 24),
    ));
    this.authFile = path.join(this.stateDir, 'credential.json');
    this.itemsDir = path.join(this.stateDir, 'items');
    // Staged media must stay inside the gateway connection's allowedRoots.
    this.mediaDir = path.join(this.outputDir, '.zy-connect-outbox', 'node');
    this.timer = null;
    this.flushTask = null;
    this.deliveryTasks = new Map();
  }
  async status() {
    const auth = await this._auth();
    const rows = await this._items();
    return {
      paired: Boolean(auth?.connectionId && auth?.token),
      connectionName: auth?.connectionName || null,
      pending: rows.filter((row) => row.state === 'pending').length,
      blocked: rows.filter((row) => row.state === 'blocked').length,
      acknowledged: rows.filter((row) => row.state === 'acknowledged').length,
    };
  }
  async _auth() {
    try { return JSON.parse(await fs.promises.readFile(this.authFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async pair() {
    const current = await this._auth();
    if (current?.token) return { paired: true, connectionName: current.connectionName };
    const bootstrap = path.join(this.outputDir, '.zhiyan', 'pairing.json');
    const input = JSON.parse(await fs.promises.readFile(bootstrap, 'utf8'));
    if (input.kind !== 'zhiyan-local-pairing' || input.schemaVersion !== 1 ||
        typeof input.code !== 'string' || !input.expiresAt ||
        Date.parse(input.expiresAt) <= Date.now() ||
        localGateway(input.gatewayUrl) !== this.gatewayUrl) {
      throw new Error('配对信息无效或已过期，请在纸燕重新准备 API 配对');
    }
    const result = await jsonFetch(this.fetch, this.gatewayUrl + '/v1/producer-pairings/exchange', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.code, label: input.connectionName || 'API producer' }),
    });
    if (!result.ok || !result.data?.credential?.token || !result.data?.connectionId) {
      throw new Error('API pairing failed (HTTP ' + result.status + ')');
    }
    await writeAtomic(this.authFile, {
      connectionId: result.data.connectionId,
      connectionName: result.data.connectionName || '',
      token: result.data.credential.token,
      gatewayUrl: this.gatewayUrl,
      pairedAt: now(),
    });
    await fs.promises.rm(bootstrap, { force: true }).catch(() => {});
    return { paired: true, connectionName: result.data.connectionName || '' };
  }
  _itemPath(contentId) { return path.join(this.itemsDir, digest(contentId) + '.json'); }
  async _readItem(contentId) {
    try { return JSON.parse(await fs.promises.readFile(this._itemPath(contentId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async _items() {
    const names = await fs.promises.readdir(this.itemsDir).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const result = [];
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      result.push(JSON.parse(await fs.promises.readFile(path.join(this.itemsDir, name), 'utf8')));
    }
    return result;
  }
  async _validatedPayload(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('delivery must be an object');
    if (Object.keys(input).some((key) => !FIELDS.has(key))) throw new Error('unsupported delivery field');
    if (typeof input.contentId !== 'string' || !input.contentId.trim() || input.contentId.length > 256) {
      throw new Error('stable contentId is required (max 256)');
    }
    if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('real video title is required');
    if (input.hashtags != null && (!Array.isArray(input.hashtags) || input.hashtags.some((x) => typeof x !== 'string'))) {
      throw new Error('hashtags must be a string array');
    }
    if (input.metadata != null && (typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
      throw new Error('metadata must be an object');
    }
    const root = await fs.promises.realpath(this.outputDir);
    const result = { ...input, contentId: input.contentId.trim(), title: input.title.trim() };
    for (const key of MEDIA_KEYS) {
      if (!input[key]) { if (key === 'videoPath') throw new Error('videoPath is required'); continue; }
      const file = await fs.promises.realpath(path.resolve(String(input[key])));
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || !childOf(root, file)) throw new Error('media outside permitted output directory');
      result[key] = file;
    }
    return result;
  }
  async _enqueue(input) {
    // A stable contentId is an idempotency key. Replaying an acknowledged
    // request must not require the source file to still exist on disk.
    if (typeof input?.contentId === 'string' && input.contentId.trim()) {
      const existing = await this._readItem(input.contentId.trim());
      if (existing) return existing;
    }
    const payload = await this._validatedPayload(input);
    const current = await this._readItem(payload.contentId);
    if (current) return current;
    const id = digest(payload.contentId);
    const dir = path.join(this.mediaDir, id);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const staged = { ...payload };
    try {
      for (const key of MEDIA_KEYS) {
        if (!payload[key]) continue;
        const target = path.join(dir, key + path.extname(payload[key]).toLowerCase());
        const tmp = target + '.tmp-' + crypto.randomUUID();
        await fs.promises.copyFile(payload[key], tmp);
        await fs.promises.rename(tmp, target);
        staged[key] = target;
      }
      const item = { contentId: payload.contentId, payload: staged, state: 'pending',
        attemptCount: 0, nextAttemptAt: null, lastError: null, deliveryId: null };
      await writeAtomic(this._itemPath(payload.contentId), item);
      return item;
    } catch (error) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  async deliver(input) {
    if (this.deliveryTasks.has(input?.contentId)) return this.deliveryTasks.get(input.contentId);
    const task = (async () => {
      const item = await this._enqueue(input);
      if (item.state === 'acknowledged') return exposed(item);
      // Missing/expired pairing is recoverable: retain the staged payload on disk.
      try { if (!(await this._auth())?.token) await this.pair(); }
      catch (error) {
        item.lastError = String(error.message || error).slice(0,250);
        await writeAtomic(this._itemPath(item.contentId), item);
        return exposed(item);
      }
      await this.flush();
      return exposed(await this._readItem(item.contentId));
    })();
    if (input?.contentId) this.deliveryTasks.set(input.contentId, task);
    try { return await task; }
    finally { if (input?.contentId) this.deliveryTasks.delete(input.contentId); }
  }
  async flush() {
    if (this.flushTask) return this.flushTask;
    this.flushTask = (async () => {
      const auth = await this._auth();
      if (!auth?.token || !auth.connectionId || localGateway(auth.gatewayUrl) !== this.gatewayUrl) return [];
      const result = [];
      for (const row of await this._items()) {
        if (row.state !== 'pending' || (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > Date.now())) continue;
        row.attemptCount += 1;
        try {
          const response = await jsonFetch(this.fetch, this.gatewayUrl +
            '/v1/producer-connections/' + encodeURIComponent(auth.connectionId) + '/deliveries', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token },
            body: JSON.stringify(row.payload),
          });
          if (response.status === 202 && response.data?.accepted && response.data?.delivery?.id) {
            row.state = 'acknowledged';
            row.deliveryId = response.data.delivery.id;
            row.lastError = null;
            row.nextAttemptAt = null;
          } else if (response.status >= 400 && response.status < 500 &&
            ![408, 425, 429].includes(response.status)) {
            row.state = 'blocked';
            row.lastError = 'Gateway rejected delivery: HTTP ' + response.status;
          } else {
            throw new Error('Gateway temporarily unavailable: HTTP ' + response.status);
          }
        } catch (error) {
          row.lastError = String(error.message || error).slice(0,250);
          row.nextAttemptAt = new Date(Date.now() + Math.min(300000, 2000 * (2 ** Math.min(row.attemptCount, 7)))).toISOString();
        }
        await writeAtomic(this._itemPath(row.contentId), row);
        if (row.state === 'acknowledged') {
          await fs.promises.rm(path.join(this.mediaDir, digest(row.contentId)), { recursive: true, force: true });
        }
        result.push(exposed(row));
      }
      return result;
    })();
    try { return await this.flushTask; }
    finally { this.flushTask = null; }
  }
  startRetry({ everyMs = 5000 } = {}) {
    if (this.timer) return;
    const retry = async () => {
      try {
        if (!(await this._auth())?.token) await this.pair();
        await this.flush();
      } catch { /* Remain queued until the gateway or pairing becomes ready. */ }
    };
    this.timer = setInterval(() => { void retry(); }, Math.max(1000, everyMs));
    this.timer.unref?.();
    void retry();
  }
  stopRetry() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}