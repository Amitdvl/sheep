# Sheep

Your sharp, no-nonsense AI mentor that lives in Telegram or Discord. Built on [NanoClaw](https://github.com/qwibitai/nanoclaw).

Sheep tracks your projects, holds you accountable, and calls out procrastination. It remembers your commitments across conversations and proactively checks in via scheduled messages.

## Features

- **Harsh mentor personality** — Direct, sharp, but genuinely caring. Pushes you to ship.
- **Persistent memory** — Tracks your projects, commitments, behavioral patterns, and goals across sessions.
- **Scheduled accountability** — Cron-based check-ins ("What did you ship today?") via Telegram or Discord.
- **Groq delegation** — Offloads cheap tasks (summaries, translations) to Groq's fast API while keeping Claude as the brain.
- **Containerized** — Each conversation runs in an isolated Docker container. Safe bash, file access, and web browsing.
- **Powered by Claude Sonnet 4.6** — via Anthropic's Agent SDK.

## Quick Start

### Recommended Install

The installer handles the machine setup for you:

- macOS / Linux: installs or verifies Homebrew/system packages, Node.js, Docker, Sheep, and the `sheep` CLI
- Windows: installs Docker Desktop, WSL2 + Ubuntu, then installs Sheep inside WSL and adds a Windows `sheep` wrapper

Run one of these:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Amitdvl/sheep/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Amitdvl/sheep/main/scripts/install.ps1 | iex
```

Already cloned:

```bash
sheep install
```

After the installer finishes:

1. Edit `.env`
2. Add your Anthropic API key
3. Add a Telegram bot token, and optionally a Discord bot token
4. Run `sheep`

Windows note: Sheep runs inside WSL2. The installer sets that up for you, but Docker Desktop still needs to complete its own first-run flow the first time.

### Required Credentials

- Anthropic API key
- Telegram bot token ([create one](https://t.me/BotFather))
- Discord bot token ([create one](https://discord.com/developers/applications)) if you also want Discord

### Manual Developer Setup

If you want to install everything yourself instead of using the installer:

- Node.js >= 20
- Docker Desktop running on macOS/Windows, or Docker Engine on Linux

Clone and install:

```bash
git clone https://github.com/Amitdvl/sheep.git
cd sheep
npm install
cp .env.example .env
```

`pnpm install` also works if you prefer pnpm.

Edit `.env`:

```env
ASSISTANT_NAME=Sheep
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
DISCORD_BOT_TOKEN=your-discord-bot-token   # optional
GROQ_API_KEY=gsk_...           # optional, for fast task delegation
```

Build the app and container image:

```bash
npm run build               # compile TypeScript
./container/build.sh         # build agent container image (first time only)
```

Run it:

```bash
sheep install    # recommended if you want the CLI to handle setup/build for you
sheep            # start Sheep
sheep shutdown   # shut down
sheep restart    # restart (also available via dashboard)
```

The `sheep` command is installed at `~/.local/bin/sheep` on macOS/Linux. On Windows, the installer creates a `sheep.cmd` wrapper that forwards to the WSL install. Once installed, `sheep` skips dependency and build work when everything is already up to date.

### Log In Through Telegram And Chat With The Bot

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather):
   - Run `/newbot`
   - Pick a display name and username
   - Copy the bot token into `TELEGRAM_BOT_TOKEN` in `.env`
2. Start Sheep:

```bash
sheep
```

3. Open your bot in Telegram:
   - Visit `https://t.me/<your_bot_username>`
   - Press **Start**
4. In that Telegram DM, send:

```text
/chatid
```

The bot replies with your exact registration ID, for example:

```text
Chat ID: `tg:123456789`
Name: Example User
Type: private
```

5. Register that Telegram chat with Sheep:

```bash
npx tsx setup/index.ts --step register -- \
  --jid "tg:123456789" \
  --name "Telegram Main" \
  --folder "telegram_main" \
  --trigger "@Sheep" \
  --channel telegram \
  --assistant-name "Sheep" \
  --no-trigger-required \
  --is-main
```

Use the exact `tg:...` value returned by `/chatid`.

6. Restart Sheep:

```bash
sheep restart
```

7. Chat with the bot in the same Telegram DM:
   - Send a normal message like `What should I ship today?`
   - Send `/ping` if you want a quick health check
   - In a private chat you do not need to prefix every message with `@Sheep` because the registration above uses `--no-trigger-required`

Before registration, the bot will answer `/chatid` and `/ping`, but it will ignore normal messages from that Telegram chat.

### Register Your Discord Channel

```bash
npx tsx setup/index.ts --step register -- \
  --jid "dc:<channel-id>" \
  --name "Sheep Main" \
  --folder "discord_main" \
  --trigger "@Sheep" \
  --channel discord \
  --no-trigger-required \
  --is-main
```

Get your channel ID: Discord Developer Mode → right-click channel → Copy Channel ID.

### Web Dashboard

```
http://localhost:3800
```

View bot status, manage scheduled tasks, browse memory files, and read conversation history.

## Architecture

```
Telegram / Discord ──> NanoClaw Host ──> Docker Container
                │                    │
                │                    ├── Claude Agent SDK (Sonnet 4.6)
                │                    ├── Bash / Web / File tools
                │                    ├── Groq skill (curl-based)
                │                    └── Memory files (read/write)
                │
                ├── Credential Proxy (API keys never enter containers)
                ├── Task Scheduler (cron-based proactive messages)
                ├── SQLite (messages, tasks, groups)
                └── Web Dashboard (status, tasks, memory)
```

## Memory System

Sheep maintains persistent memory in a group folder such as `groups/telegram_main/` or `groups/discord_main/`:

| File | Purpose |
|------|---------|
| `profile.md` | Core context, identity, mission |
| `commitments.md` | Tracked promises with deadlines |
| `projects.md` | Active projects and status |
| `patterns.md` | Behavioral patterns (good and bad) |
| `conversations/` | Archived conversation history |

Sheep reads and updates these files after every meaningful conversation.

## Personality

Sheep is a sharp, no-nonsense mentor:

- Asks "what did you ship?" every day
- Tracks commitments and follows up relentlessly
- Cuts through overthinking — "pick one, ship it, iterate"
- Challenges scope creep — "what's the MVP?"
- Connects daily work to the bigger picture
- Celebrates wins briefly, then asks "what's next?"

Edit `groups/global/CLAUDE.md` or your group file such as `groups/telegram_main/CLAUDE.md` to customize.

## Groq Delegation

Sheep delegates cheap/fast tasks to Groq (Llama 3.3 70B) via the `/groq` container skill:

- Article summarization
- Translation
- Quick factual lookups
- Simple text drafting

Core mentoring, accountability, and memory management always run on Claude.

## Based On

Forked from [NanoClaw](https://github.com/qwibitai/nanoclaw) — a lightweight, secure Claude agent framework. See their docs for container configuration, channel system, and advanced features.

## License

MIT
