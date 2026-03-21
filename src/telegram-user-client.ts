/**
 * Telegram user client (MTProto via GramJS).
 * Runs alongside the bot to read ALL Telegram conversations —
 * private chats, groups, and channels.
 *
 * Messages are stored in the database and picked up by the
 * cross-channel snapshot (messages_snapshot.json) for agent queries.
 */

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { storeChatMetadata, storeMessageDirect } from './db.js';

function chatIdToJid(peerId: { className: string; userId?: unknown; chatId?: unknown; channelId?: unknown }): string | null {
  if (peerId.className === 'PeerUser') {
    return `tg:${peerId.userId?.toString()}`;
  } else if (peerId.className === 'PeerChat') {
    return `tg:-${peerId.chatId?.toString()}`;
  } else if (peerId.className === 'PeerChannel') {
    return `tg:-100${peerId.channelId?.toString()}`;
  }
  return null;
}

async function getEntityName(
  client: import('telegram').TelegramClient,
  peer: object,
): Promise<{ name: string; isGroup: boolean }> {
  try {
    const entity = (await client.getEntity(peer as never)) as unknown as Record<string, unknown>;
    if (entity.className === 'User') {
      const parts = [entity.firstName, entity.lastName].filter(Boolean);
      const name = parts.length > 0 ? parts.join(' ') : (entity.username as string) || 'Unknown';
      return { name, isGroup: false };
    } else {
      return { name: (entity.title as string) || 'Unknown', isGroup: true };
    }
  } catch {
    return { name: 'Unknown', isGroup: false };
  }
}

export function startTelegramUserClient(): void {
  const envVars = readEnvFile(['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_USER_SESSION']);
  const apiIdStr = process.env.TELEGRAM_API_ID || envVars.TELEGRAM_API_ID || '';
  const apiHash = process.env.TELEGRAM_API_HASH || envVars.TELEGRAM_API_HASH || '';
  const sessionStr = process.env.TELEGRAM_USER_SESSION || envVars.TELEGRAM_USER_SESSION || '';

  if (!apiIdStr || !apiHash || !sessionStr) {
    logger.debug('Telegram user client: credentials not set, skipping (run pnpm auth:telegram-user to enable)');
    return;
  }

  const apiId = parseInt(apiIdStr, 10);
  if (isNaN(apiId)) {
    logger.warn({ apiIdStr }, 'Telegram user client: TELEGRAM_API_ID is not a valid number');
    return;
  }

  // Import telegram dynamically (CJS package)
  Promise.all([
    import('telegram'),
    import('telegram/sessions/index.js'),
    import('telegram/events/index.js'),
  ]).then(([{ TelegramClient }, { StringSession }, { NewMessage }]) => {
    const client = new TelegramClient(
      new StringSession(sessionStr),
      apiId,
      apiHash,
      { connectionRetries: 5, retryDelay: 1000 },
    );

    client.connect().then(async () => {
      const me = await client.getMe() as unknown as Record<string, unknown>;
      const myName = [me.firstName, me.lastName].filter(Boolean).join(' ') || (me.username as string) || 'me';
      logger.info({ username: me.username, id: me.id }, 'Telegram user client connected');
      console.log(`\n  Telegram user: ${myName} (@${me.username || me.id})`);
      console.log('  Reading messages from all Telegram conversations\n');

      client.addEventHandler(
        async (event: { message: Record<string, unknown> }) => {
          const msg = event.message;
          if (!msg || !msg.peerId) return;

          const rawText = msg.message as string;
          if (!rawText) return;

          const peerId = msg.peerId as { className: string; userId?: unknown; chatId?: unknown; channelId?: unknown };
          const chatJid = chatIdToJid(peerId);
          if (!chatJid) return;

          const timestamp = new Date((msg.date as number) * 1000).toISOString();
          const isFromMe = Boolean(msg.out);

          // Get chat name and group status
          const { name: chatName, isGroup } = await getEntityName(client, peerId);

          // Get sender name for group messages
          let senderName = isFromMe ? myName : 'Unknown';
          if (!isFromMe && msg.fromId) {
            const { name } = await getEntityName(client, msg.fromId as object);
            senderName = name;
          }

          const msgId = `tgu:${msg.id?.toString()}`;

          storeChatMetadata(chatJid, timestamp, chatName, 'telegram', isGroup);
          storeMessageDirect({
            id: msgId,
            chat_jid: chatJid,
            sender: isFromMe ? 'me' : String((msg.fromId as Record<string, unknown>)?.userId ?? ''),
            sender_name: senderName,
            content: rawText,
            timestamp,
            is_from_me: isFromMe,
            is_bot_message: false,
          });

          logger.debug({ chatJid, chatName, isFromMe }, 'Telegram user message stored');
        },
        new NewMessage({}),
      );
    }).catch((err: Error) => {
      logger.error({ err: err.message }, 'Telegram user client failed to connect');
    });
  }).catch((err: Error) => {
    logger.error({ err: err.message }, 'Failed to load telegram package');
  });
}
