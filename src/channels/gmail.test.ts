import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));

import { GmailChannel, GmailChannelOpts } from './gmail.js';

function makeOpts(overrides?: Partial<GmailChannelOpts>): GmailChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
    ...overrides,
  };
}

describe('GmailChannel', () => {
  let channel: GmailChannel;

  beforeEach(() => {
    channel = new GmailChannel(makeOpts());
  });

  it('owns gmail thread JIDs', () => {
    expect(channel.ownsJid('gmail:abc123')).toBe(true);
    expect(channel.ownsJid('gmail:thread-id-456')).toBe(true);
  });

  it('rejects non-gmail JIDs', () => {
    expect(channel.ownsJid('12345@g.us')).toBe(false);
    expect(channel.ownsJid('tg:123')).toBe(false);
    expect(channel.ownsJid('dc:456')).toBe(false);
  });

  it('reports the channel name', () => {
    expect(channel.name).toBe('gmail');
  });

  it('starts disconnected', () => {
    expect(channel.isConnected()).toBe(false);
  });

  it('disconnect keeps the channel disconnected', async () => {
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('uses the primary unread inbox query by default', () => {
    const query = (
      channel as unknown as { buildQuery: () => string }
    ).buildQuery();
    expect(query).toBe('is:unread category:primary');
  });

  it('accepts a custom poll interval', () => {
    const custom = new GmailChannel(makeOpts(), 30000);
    expect(custom.name).toBe('gmail');
  });
});
