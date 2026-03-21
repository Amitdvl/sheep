# Sheep
<img width="1536" height="1024" alt="sheepit" src="https://github.com/user-attachments/assets/d7842622-fa12-4450-955e-a30445a01752" />

Your sharp, no-nonsense AI mentor that lives in Discord. Built on [NanoClaw](https://github.com/qwibitai/nanoclaw).

Sheep tracks your projects, holds you accountable, and calls out procrastination. It remembers your commitments across conversations and proactively checks in via scheduled messages.

## Features

- **Harsh mentor personality** — Direct, sharp, but genuinely caring. Pushes you to ship.
- **Persistent memory** — Tracks your projects, commitments, behavioral patterns, and goals across sessions.
- **Scheduled accountability** — Cron-based check-ins ("What did you ship today?") via Discord.
- **Groq delegation** — Offloads cheap tasks (summaries, translations) to Groq's fast API while keeping Claude as the brain.
- **Containerized** — Each conversation runs in an isolated Docker container. Safe bash, file access, and web browsing.
- **Powered by Claude Sonnet 4.6** — via Anthropic's Agent SDK.

## Quick Start

### Prerequisites

- Node.js >= 20
- Docker Desktop running
- Anthropic API key
- Discord bot token ([create one](https://discord.com/developers/applications))

### Setup

```bash
git clone https://github.com/Amitdvl/sheep.git
cd sheep
pnpm install
cp .env.example .env
```

Edit `.env`:

```env
ASSISTANT_NAME=Sheep
ANTHROPIC_API_KEY=sk-ant-...
DISCORD_BOT_TOKEN=your-discord-bot-token
GROQ_API_KEY=gsk_...           # optional, for fast task delegation
```

### Build & Run

```bash
pnpm build                   # compile TypeScript
./container/build.sh         # build agent container image (first time only)
```

### Start / Stop

```bash
sheep            # install deps, build, and start (from anywhere)
sheep shutdown   # shut down
sheep restart    # restart (also available via dashboard)
```

The `sheep` command is a global CLI installed at `~/.local/bin/sheep`. It skips install/build if already up to date, so subsequent starts are instant. The dashboard **Restart** button also works seamlessly — `sheep` auto-relaunches after a restart.

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
Discord ──> NanoClaw Host ──> Docker Container
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

Sheep maintains persistent memory in `groups/discord_main/`:

| File | Purpose |
|------|---------|
| `about-amit.md` | Core facts, identity, mission |
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

Edit `groups/global/CLAUDE.md` or `groups/discord_main/CLAUDE.md` to customize.

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
