import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { google } from 'googleapis';

import { GMAIL_CONFIG_DIR } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

type ParsedArgs = {
  options: Record<string, string | true>;
};

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const options: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
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

  return { options };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function resolveKeysPath(options: Record<string, string | true>): string {
  const fromArg = options['keys'];
  if (fromArg && fromArg !== true) return path.resolve(fromArg);
  return path.join(GMAIL_CONFIG_DIR, 'gcp-oauth.keys.json');
}

function maybeCopyKeys(keysPath: string): string {
  const target = path.join(GMAIL_CONFIG_DIR, 'gcp-oauth.keys.json');
  fs.mkdirSync(GMAIL_CONFIG_DIR, { recursive: true });
  if (path.resolve(keysPath) !== path.resolve(target)) {
    fs.copyFileSync(keysPath, target);
  }
  return target;
}

function extractCode(value: string): string {
  if (!value) fail('Missing OAuth redirect URL or code');
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const url = new URL(value);
    const code = url.searchParams.get('code');
    if (!code) fail('Redirect URL did not contain a code parameter');
    return code;
  }
  return value;
}

async function main(): Promise<void> {
  const { options } = parseArgs();
  const keysPath = resolveKeysPath(options);
  if (!fs.existsSync(keysPath)) {
    fail(`OAuth client JSON not found: ${keysPath}`);
  }

  const storedKeysPath = maybeCopyKeys(keysPath);
  const keys = JSON.parse(fs.readFileSync(storedKeysPath, 'utf-8'));
  const clientConfig = keys.installed || keys.web || keys;
  const { client_id, client_secret, redirect_uris } = clientConfig;
  const redirectUri = redirect_uris?.[0];
  if (!client_id || !client_secret || !redirectUri) {
    fail('OAuth client JSON is missing client_id, client_secret, or redirect_uris[0]');
  }

  const auth = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const redirectInput = options['redirect-url'];
  const codeInput = options['code'];

  if (
    (!redirectInput || redirectInput === true) &&
    (!codeInput || codeInput === true)
  ) {
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    console.log(`Gmail OAuth client stored at ${storedKeysPath}`);
    console.log('');
    console.log('Open this URL, approve access, then paste the full redirect URL back to me:');
    console.log(authUrl);
    console.log('');

    if (options['open']) {
      try {
        execFileSync('open', [authUrl], { stdio: 'ignore' });
        console.log('Opened the URL in your default browser.');
      } catch {
        console.log('Could not auto-open the browser. Open the URL manually.');
      }
    }
    return;
  }

  const rawInput =
    redirectInput && redirectInput !== true
      ? redirectInput
      : codeInput && codeInput !== true
        ? codeInput
        : '';
  const code = extractCode(rawInput);
  const { tokens } = await auth.getToken(code);
  if (!tokens) fail('Google did not return OAuth tokens');

  const tokensPath = path.join(GMAIL_CONFIG_DIR, 'credentials.json');
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + '\n');
  auth.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  console.log(
    `Gmail authorization complete for ${profile.data.emailAddress || 'unknown account'}`,
  );
  console.log(`Tokens saved to ${tokensPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
