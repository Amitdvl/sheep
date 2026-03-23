/**
 * gmail-cli — container-side Gmail helper for Sheep.
 *
 * Usage:
 *   node /tmp/dist/gmail-cli.js profile
 *   node /tmp/dist/gmail-cli.js list [--query <gmail query>] [--limit <n>]
 *   node /tmp/dist/gmail-cli.js read --message-id <id>
 *   node /tmp/dist/gmail-cli.js thread --thread-id <id>
 *   node /tmp/dist/gmail-cli.js send --to <email> --subject <text> [--body <text> | --body-file <path|- >]
 *   node /tmp/dist/gmail-cli.js reply --thread-id <id> --to <email> --subject <text> --in-reply-to <message-id> [--body <text> | --body-file <path|- >]
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { gmail_v1, google } from 'googleapis';

type ParsedArgs = {
  command: string | null;
  options: Record<string, string | true>;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? null;
  const options: Record<string, string | true> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      i++;
    } else {
      options[key] = true;
    }
  }

  return { command, options };
}

function requireOption(
  options: Record<string, string | true>,
  key: string,
): string {
  const value = options[key];
  if (!value || value === true) fail(`Missing required --${key}`);
  return value;
}

async function loadBody(options: Record<string, string | true>): Promise<string> {
  const body = options['body'];
  if (body && body !== true) return body;

  const bodyFile = options['body-file'];
  if (!bodyFile || bodyFile === true) {
    fail('Provide --body or --body-file');
  }

  if (bodyFile === '-') {
    return await new Promise<string>((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }

  return fs.readFileSync(bodyFile, 'utf-8');
}

async function createGmailClient(): Promise<{
  gmail: gmail_v1.Gmail;
  email: string;
}> {
  const credDir = path.join(os.homedir(), '.config', 'sheep', 'gmail');
  const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
  const tokensPath = path.join(credDir, 'credentials.json');

  if (!fs.existsSync(keysPath) || !fs.existsSync(tokensPath)) {
    fail(
      'Gmail credentials not found. Expected /home/node/.config/sheep/gmail/gcp-oauth.keys.json and credentials.json',
    );
  }

  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  const clientConfig = keys.installed || keys.web || keys;
  const { client_id, client_secret, redirect_uris } = clientConfig;

  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0],
  );
  auth.setCredentials(tokens);
  auth.on('tokens', (newTokens) => {
    const current = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    Object.assign(current, newTokens);
    fs.writeFileSync(tokensPath, JSON.stringify(current, null, 2));
  });

  const gmail = google.gmail({ version: 'v1', auth });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return {
    gmail,
    email: profile.data.emailAddress || '',
  };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64').toString('utf-8');
}

function extractTextBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }

    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return '';
}

function headerMap(
  payload: gmail_v1.Schema$MessagePart | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of payload?.headers || []) {
    if (!header.name) continue;
    headers[header.name.toLowerCase()] = header.value || '';
  }
  return headers;
}

async function listMessages(options: Record<string, string | true>) {
  const { gmail } = await createGmailClient();
  const query =
    options['query'] && options['query'] !== true
      ? options['query']
      : 'category:primary';
  const limit = Math.min(
    Math.max(parseInt(String(options['limit'] || '10'), 10) || 10, 1),
    50,
  );

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: String(query),
    maxResults: limit,
  });

  const rows = [];
  for (const stub of res.data.messages || []) {
    if (!stub.id) continue;
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: stub.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Message-ID', 'Date'],
    });
    const headers = headerMap(full.data.payload);
    rows.push({
      id: full.data.id,
      threadId: full.data.threadId,
      labelIds: full.data.labelIds || [],
      from: headers['from'] || '',
      subject: headers['subject'] || '',
      messageId: headers['message-id'] || '',
      date: headers['date'] || '',
      snippet: full.data.snippet || '',
    });
  }

  console.log(JSON.stringify({ query, count: rows.length, messages: rows }, null, 2));
}

async function readMessage(options: Record<string, string | true>) {
  const { gmail } = await createGmailClient();
  const messageId = requireOption(options, 'message-id');
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const headers = headerMap(res.data.payload);
  console.log(
    JSON.stringify(
      {
        id: res.data.id,
        threadId: res.data.threadId,
        labelIds: res.data.labelIds || [],
        snippet: res.data.snippet || '',
        subject: headers['subject'] || '',
        from: headers['from'] || '',
        to: headers['to'] || '',
        cc: headers['cc'] || '',
        date: headers['date'] || '',
        messageId: headers['message-id'] || '',
        body: extractTextBody(res.data.payload),
      },
      null,
      2,
    ),
  );
}

async function readThread(options: Record<string, string | true>) {
  const { gmail } = await createGmailClient();
  const threadId = requireOption(options, 'thread-id');
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = (res.data.messages || []).map((message) => {
    const headers = headerMap(message.payload);
    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
      subject: headers['subject'] || '',
      from: headers['from'] || '',
      to: headers['to'] || '',
      date: headers['date'] || '',
      messageId: headers['message-id'] || '',
      snippet: message.snippet || '',
      body: extractTextBody(message.payload),
    };
  });

  console.log(JSON.stringify({ threadId, messages }, null, 2));
}

function encodeRawMessage(raw: string): string {
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendMessage(options: Record<string, string | true>) {
  const { gmail, email } = await createGmailClient();
  const to = requireOption(options, 'to');
  const subject = requireOption(options, 'subject');
  const body = await loadBody(options);

  const raw = [
    `To: ${to}`,
    `From: ${email}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeRawMessage(raw),
    },
  });

  console.log(
    JSON.stringify(
      { ok: true, action: 'send', id: res.data.id, threadId: res.data.threadId },
      null,
      2,
    ),
  );
}

async function replyToMessage(options: Record<string, string | true>) {
  const { gmail, email } = await createGmailClient();
  const threadId = requireOption(options, 'thread-id');
  const to = requireOption(options, 'to');
  const subject = requireOption(options, 'subject');
  const inReplyTo = requireOption(options, 'in-reply-to');
  const body = await loadBody(options);

  const normalizedSubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const raw = [
    `To: ${to}`,
    `From: ${email}`,
    `Subject: ${normalizedSubject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${inReplyTo}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeRawMessage(raw),
      threadId,
    },
  });

  console.log(
    JSON.stringify(
      { ok: true, action: 'reply', id: res.data.id, threadId: res.data.threadId },
      null,
      2,
    ),
  );
}

async function profile() {
  const { email } = await createGmailClient();
  console.log(JSON.stringify({ email }, null, 2));
}

function printHelp(): void {
  console.log(`gmail-cli

Usage:
  node /tmp/dist/gmail-cli.js profile
  node /tmp/dist/gmail-cli.js list [--query <gmail query>] [--limit <n>]
  node /tmp/dist/gmail-cli.js read --message-id <id>
  node /tmp/dist/gmail-cli.js thread --thread-id <id>
  node /tmp/dist/gmail-cli.js send --to <email> --subject <text> [--body <text> | --body-file <path|- >]
  node /tmp/dist/gmail-cli.js reply --thread-id <id> --to <email> --subject <text> --in-reply-to <message-id> [--body <text> | --body-file <path|- >]
`);
}

async function main() {
  const { command, options } = parseArgs();

  if (!command || command === 'help' || options['help']) {
    printHelp();
    return;
  }

  if (command === 'profile') {
    await profile();
    return;
  }
  if (command === 'list') {
    await listMessages(options);
    return;
  }
  if (command === 'read') {
    await readMessage(options);
    return;
  }
  if (command === 'thread') {
    await readThread(options);
    return;
  }
  if (command === 'send') {
    await sendMessage(options);
    return;
  }
  if (command === 'reply') {
    await replyToMessage(options);
    return;
  }

  fail(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
