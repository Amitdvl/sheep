/**
 * sheep-messages — CLI for querying cross-channel message history.
 *
 * Usage: node /tmp/dist/sheep-messages.js [options]
 *
 *   --list-chats          List all known chats with their JIDs
 *   --channel <name>      Filter by channel: telegram, discord, whatsapp
 *   --jid <jid>           Filter by specific chat JID
 *   --search <term>       Search in message content (case-insensitive)
 *   --since <iso>         Return messages after this ISO timestamp
 *   --limit <n>           Max messages to return (default 50, max 200)
 */

import fs from 'fs';

const SNAPSHOT_PATH = '/workspace/ipc/messages_snapshot.json';

interface Chat {
  jid: string;
  name: string;
  channel: string;
  last_message_time: string;
}

interface Message {
  chat_jid: string;
  chat_name: string;
  channel: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

interface Snapshot {
  generatedAt: string;
  chats: Chat[];
  messages: Message[];
}

function loadSnapshot(): Snapshot {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error('No messages snapshot found at ' + SNAPSHOT_PATH);
    console.error('Sheep generates one automatically when you next send a message.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
}

function parseArgs(): Record<string, string | true> {
  const result: Record<string, string | true> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[key] = argv[++i];
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

const args = parseArgs();

if (args['help']) {
  console.log(`sheep-messages — query cross-channel message history

Usage:
  node /tmp/dist/sheep-messages.js --list-chats
  node /tmp/dist/sheep-messages.js --channel telegram [--search <term>] [--limit 50]
  node /tmp/dist/sheep-messages.js --jid tg:123456 [--since 2025-01-01T00:00:00Z]

Options:
  --list-chats    List all chats with JIDs
  --channel       Filter by channel (telegram, discord, whatsapp)
  --jid           Filter by exact chat JID
  --search        Case-insensitive text search in content
  --since         ISO timestamp lower bound
  --limit         Max results (default 50, max 200)
`);
  process.exit(0);
}

const snapshot = loadSnapshot();

if (args['list-chats']) {
  const chats = snapshot.chats.filter((c) => !c.jid.startsWith('__'));
  if (!chats.length) {
    console.log('No chats found.');
  } else {
    console.log(`${chats.length} chats (snapshot: ${snapshot.generatedAt.slice(0, 16)}):\n`);
    for (const c of chats) {
      const last = c.last_message_time?.slice(0, 16) ?? 'n/a';
      console.log(`  ${(c.channel || 'unknown').padEnd(10)} ${c.name.padEnd(30)} ${c.jid.padEnd(25)} last: ${last}`);
    }
  }
  process.exit(0);
}

// Query messages
let msgs = snapshot.messages;

if (args['jid']) {
  msgs = msgs.filter((m) => m.chat_jid === args['jid']);
} else if (args['channel']) {
  msgs = msgs.filter((m) => m.channel === args['channel']);
}

if (args['since']) {
  msgs = msgs.filter((m) => m.timestamp > String(args['since']));
}

if (args['search']) {
  const term = String(args['search']).toLowerCase();
  msgs = msgs.filter((m) => m.content.toLowerCase().includes(term));
}

const limit = Math.min(Number(args['limit'] ?? 50), 200);
// Snapshot is newest-first; take `limit` most recent, then reverse to chronological
msgs = msgs.slice(0, limit).reverse();

if (!msgs.length) {
  console.log('No messages found.');
  process.exit(0);
}

console.log(`${msgs.length} messages (snapshot: ${snapshot.generatedAt.slice(0, 16)}):\n`);
for (const m of msgs) {
  const who = m.is_from_me ? 'me' : m.sender_name;
  console.log(`[${m.timestamp.slice(0, 16)}] ${m.channel}/${m.chat_name} — ${who}: ${m.content}`);
}
