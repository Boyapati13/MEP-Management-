// Passive MEP collector. It never invokes agent tools or replies to WhatsApp.
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qr from 'qrcode-terminal';
import { mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DeliveryQueue, projectMessage } from './queue.js';

const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const session = value('--session', join(homedir(), '.octo/whatsapp/session'));
const pairOnly = args.includes('--pair-only');
const listGroups = args.includes('--list-groups');
const groups = new Set((process.env.WHATSAPP_GROUP_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const target = process.env.MEP_INGEST_URL || '';
const token = process.env.OCTO_INGEST_TOKEN || '';
if (!pairOnly && !listGroups) {
  const url = new URL(target);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || (process.env.MEP_ALLOW_PRIVATE_HTTP === 'true' && url.hostname === 'mep-platform')))) throw new Error('MEP_INGEST_URL requires HTTPS or loopback HTTP');
  if (url.username || url.password || url.pathname !== '/api/integrations/octo/messages' || url.search || url.hash) throw new Error('Use the exact MEP ingestion endpoint');
  if (token.length < 32 || !groups.size || [...groups].some(g => !/^[0-9-]+@g\.us$/.test(g))) throw new Error('Set a 32+ character OCTO_INGEST_TOKEN and explicit WHATSAPP_GROUP_IDS');
}
mkdirSync(session, { recursive: true, mode: 0o700 });
chmodSync(session, 0o700);
const queue = new DeliveryQueue(join(session, 'delivery.db'));
chmodSync(join(session, 'delivery.db'), 0o600);
const { state, saveCreds } = await useMultiFileAuthState(session);
let socket;
let stopped = false;
let delivering = false;
async function deliver() {
  if (delivering || pairOnly || listGroups) return;
  delivering = true;
  try {
    for (const row of queue.pending()) {
      const response = await fetch(target, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: row.payload
      });
      if (!response.ok) {
        console.error(`MEP delivery pending: HTTP ${response.status}`);
        if (response.status === 401 || response.status >= 500) break;
        continue;
      }
      queue.ack(row.id);
    }
  } catch { console.error('MEP unavailable; messages remain in the local queue'); }
  finally { delivering = false; }
}
async function connect() {
  if (stopped) return;
  socket = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), syncFullHistory: false });
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr: data }) => {
    if (data) qr.generate(data, { small: true });
    if (connection === 'open') {
      console.log('WhatsApp linked');
      if (listGroups) {
        const all = await socket.groupFetchAllParticipating();
        console.log(JSON.stringify(Object.values(all).map(g => ({ id: g.id, name: g.subject })), null, 2));
      }
      if (pairOnly || listGroups) { stopped = true; socket.end(undefined); clearInterval(timer); queue.close(); }
    }
    if (connection === 'close' && !stopped) {
      if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
        console.error('WhatsApp logged out. Pair again.'); stopped = true; clearInterval(timer); queue.close();
      } else setTimeout(() => connect().catch(() => console.error('Reconnect failed')), 5000);
    }
  });
  socket.ev.on('messages.upsert', ({ type, messages }) => {
    if (stopped || pairOnly || listGroups || type !== 'notify') return;
    for (const msg of messages) {
      const payload = projectMessage(msg, groups);
      if (payload) queue.add(payload);
    }
    void deliver();
  });
}
const timer = setInterval(() => void deliver(), 5000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopped = true; clearInterval(timer); socket?.end(undefined); process.exit(0); });
await connect();
