---
name: groq
description: Call Groq's fast LLM API for cheap/quick tasks like summarization, translation, quick research, and general questions. Use instead of doing these tasks yourself to save cost and time. Requires GROQ_API_KEY env var.
---

# Groq — Fast LLM for Delegated Tasks

You have access to Groq's API via the `GROQ_API_KEY` environment variable. Use it for tasks where speed and cost matter more than deep reasoning.

## When to use Groq

- Summarizing articles or long text
- Translating content
- Quick factual lookups or general knowledge questions
- Drafting simple text (emails, messages, descriptions)
- Parsing or reformatting data

## When NOT to use Groq (use yourself instead)

- Complex reasoning about Amit's goals, patterns, or strategy
- Anything requiring memory of past conversations
- Multi-step planning or decision-making
- Tool use or file operations
- Anything that needs your personality (mentoring, accountability)

## How to call Groq

Use curl via Bash. Groq uses the OpenAI-compatible API format.

### Basic query

```bash
curl -s https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [
      {"role": "user", "content": "YOUR PROMPT HERE"}
    ],
    "temperature": 0.3
  }' | jq -r '.choices[0].message.content'
```

### With system prompt

```bash
curl -s https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user", "content": "YOUR PROMPT HERE"}
    ],
    "temperature": 0.3
  }' | jq -r '.choices[0].message.content'
```

## Available models

- `llama-3.3-70b-versatile` — best general-purpose (default, use this)
- `llama-3.1-8b-instant` — fastest, use for very simple tasks
- `deepseek-r1-distill-llama-70b` — good for reasoning tasks

## Tips

- Always pipe through `jq -r '.choices[0].message.content'` to extract just the response text
- For long inputs, write the prompt to a temp file and use `@/tmp/prompt.json` with curl's `-d` flag
- Keep temperature low (0.3) for factual tasks, higher (0.7-0.9) for creative tasks
