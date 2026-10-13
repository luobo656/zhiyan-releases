#!/usr/bin/env node
/**
 * Portable ZY-Connect MCP stdio server (MCP JSON-RPC over newline-delimited JSON).
 * Discovery, dry-run validation and explicit local pairing; no social posting tool.
 */
import readline from 'node:readline';
import { ZyConnect } from '../node/zy-connect.mjs';

const TOOLS = [
  { name: 'zy_contract', description: 'Read Zhiyan delivery v1 contract on the local PC (no credentials).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'zy_status', description: 'Show local producer SDK pairing and durable outbox summary; never return secrets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'zy_preview', description: 'Validate a future delivery payload against the local allowed media folder without sending.',
    inputSchema: { type: 'object', properties: {
      work: { type: 'object', description: 'zhiyan.delivery v1 document' }
    }, required: ['work'], additionalProperties: false } },
  { name: 'zy_pair', description: 'Consume locally prepared one-time pairing (requires explicit confirm=true). Does not submit media.',
    inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } },
      required: ['confirm'], additionalProperties: false } },
  { name: 'zy_guide', description: 'Give concise developer instructions and public SDK/spec URLs. No network required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
const GUIDE = [
  'ZY-Connect v1: API-first local producer integration.',
  'https://github.com/luobo656/zhiyan-releases/blob/main/zy-connect/AI-INTEGRATION.md',
  'SDK: https://github.com/luobo656/zhiyan-releases/tree/main/zy-connect',
  'Use Node/Python SDK deliver() only after the producer fully writes video and real metadata.',
  'Pair via the short-lived .zhiyan/pairing.json prepared in the Zhiyan UI.',
  'MCP is for discovery/pairing/validation; the SDK sends media metadata to the loopback API.',
  'Never change account switches, collect platform passwords or publish real posts during testing.',
  'Incoming producer deliveries always create manual-confirm tasks.',
].join('\n');

function client() {
  const outputDir = process.env.ZY_CONNECT_OUTPUT_DIR;
  if (!outputDir) throw new Error('Set ZY_CONNECT_OUTPUT_DIR to your permitted local video output folder');
  return new ZyConnect({ outputDir,
    gatewayUrl: process.env.ZY_CONNECT_GATEWAY_URL || 'http://127.0.0.1:17351',
    stateDir: process.env.ZY_CONNECT_STATE_DIR || null });
}
async function callTool(name, args) {
  if (name === 'zy_guide') return GUIDE;
  if (name === 'zy_contract') {
    const gateway = process.env.ZY_CONNECT_GATEWAY_URL || 'http://127.0.0.1:17351';
    // The URL is validated before requesting any arbitrary endpoint.
    const app = new ZyConnect({ outputDir: process.env.ZY_CONNECT_OUTPUT_DIR || process.cwd(), gatewayUrl: gateway });
    const response = await fetch(app.gatewayUrl + '/v1/delivery-contract', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Contract discovery failed HTTP ' + response.status);
    return JSON.stringify(await response.json());
  }
  const app = client();
  if (name === 'zy_status') return JSON.stringify(await app.status());
  if (name === 'zy_preview') {
    await app._validatedPayload(args?.work);
    return JSON.stringify({ valid: true, action: 'no content submitted', publishing: false });
  }
  if (name === 'zy_pair') {
    if (args?.confirm !== true) throw new Error('Pairing requires explicit confirm=true');
    return JSON.stringify(await app.pair());
  }
  throw new Error('Unknown ZY-Connect MCP tool');
}
function reply(id, body) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\n');
}
async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && 'id' in msg) reply(msg.id, { error: { code: -32600, message: 'Invalid MCP request' } });
    return;
  }
  const id = msg.id;
  if (id === undefined || id === null) return;
  try {
    if (msg.method === 'initialize') {
      const requested = msg.params?.protocolVersion;
      const version = ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requested)
        ? requested : '2024-11-05';
      reply(id, { result: {
        protocolVersion: version,
        serverInfo: { name: 'zhiyan-connect-local', version: '1.0.0' },
        capabilities: { tools: {}, resources: {} },
      } });
    } else if (msg.method === 'ping') {
      reply(id, { result: {} });
    } else if (msg.method === 'tools/list') {
      reply(id, { result: { tools: TOOLS } });
    } else if (msg.method === 'tools/call') {
      const text = await callTool(msg.params?.name, msg.params?.arguments || {});
      reply(id, { result: { content: [{ type: 'text', text }] } });
    } else if (msg.method === 'resources/list') {
      reply(id, { result: { resources: [{
        uri: 'zy-connect://guide',
        name: 'ZY-Connect API-first integration guide',
        mimeType: 'text/plain',
      }] } });
    } else if (msg.method === 'resources/read' && msg.params?.uri === 'zy-connect://guide') {
      reply(id, { result: { contents: [{
        uri: 'zy-connect://guide', mimeType: 'text/plain', text: GUIDE,
      }] } });
    } else {
      reply(id, { error: { code: -32601, message: 'Unsupported MCP method' } });
    }
  } catch (error) {
    // Do not log exception stacks or request bodies: pairing codes are secrets.
    reply(id, { result: { isError: true, content: [{
      type: 'text', text: String(error.message || 'ZY-Connect MCP error').slice(0, 300),
    }] } });
  }
}
const channel = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of channel) {
  if (!line.trim()) continue;
  try { await handle(JSON.parse(line)); }
  catch { /* Silently ignore malformed, unauthenticated stdin. */ }
}