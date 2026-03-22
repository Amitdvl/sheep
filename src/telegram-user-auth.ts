/**
 * One-time Telegram user account authentication.
 * Saves session string to .env so the user client can connect on startup.
 *
 * Usage: pnpm auth:telegram-user
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

console.log(`
Telegram User Client Setup
──────────────────────────
This lets Sheep read ALL your Telegram conversations (private chats, groups, channels).
It logs in as your personal Telegram account, not as the bot.

You need API credentials from https://my.telegram.org:
  1. Go to https://my.telegram.org and sign in
  2. Click "API development tools"
  3. Create an app (any name, any platform)
  4. Copy the App api_id and App api_hash
`);

const apiIdStr = await ask('API ID (numbers only): ');
const apiId = parseInt(apiIdStr, 10);
if (isNaN(apiId)) {
  console.error('Invalid API ID — must be a number');
  process.exit(1);
}

const apiHash = await ask('API Hash: ');
if (!apiHash) {
  console.error('API Hash is required');
  process.exit(1);
}

// Dynamically import telegram (CJS) after we have credentials
const { TelegramClient } = await import('telegram');
const { StringSession } = await import('telegram/sessions/index.js');

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 5,
});

console.log('\nConnecting to Telegram...\n');

await client.start({
  phoneNumber: async () =>
    ask('Your phone number (with country code, e.g. +972501234567): '),
  password: async () => ask('2FA password (press Enter if none): '),
  phoneCode: async () => ask('OTP code sent to your Telegram: '),
  onError: (err) => console.error('Auth error:', err.message),
});

const sessionString = String(client.session.save());
console.log('\n✓ Authentication successful!\n');

// Update .env file
const envPath = path.resolve(__dirname, '..', '.env');
let envContent = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf-8')
  : '';

// Remove existing entries
envContent = envContent
  .replace(/^TELEGRAM_API_ID=.*\n?/m, '')
  .replace(/^TELEGRAM_API_HASH=.*\n?/m, '')
  .replace(/^TELEGRAM_USER_SESSION=.*\n?/m, '')
  .replace(/\n{3,}/g, '\n\n');

if (envContent && !envContent.endsWith('\n')) envContent += '\n';
envContent += `TELEGRAM_API_ID=${apiId}\n`;
envContent += `TELEGRAM_API_HASH=${apiHash}\n`;
envContent += `TELEGRAM_USER_SESSION=${sessionString}\n`;

fs.writeFileSync(envPath, envContent);

console.log('Saved to .env:');
console.log(`  TELEGRAM_API_ID=${apiId}`);
console.log('  TELEGRAM_API_HASH=****');
console.log('  TELEGRAM_USER_SESSION=<session string>');
console.log(
  '\nRestart Sheep: kill $(pgrep -f "dist/index.js") && node dist/index.js >> logs/sheep.log 2>&1 &\n',
);

await client.disconnect();
process.exit(0);
