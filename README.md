# AI Gateway

Tiny Flask proxy that sits between your apps and Hack Club's AI service. Hides the real upstream key, lets you hand out disposable keys, and keeps some gentle rate limits so you don't burn through quota. I run it for my own side projects; it isn't fancy, but it holds up.

## Setup (10-minute version)

```bash
git clone https://github.com/bbarni2020/AI.git
cd AI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # set ADMIN_USER, ADMIN_PASS, UPSTREAM_API_KEY, etc.
./run.sh              # starts Waitress on 127.0.0.1:5000
```

Hit `http://127.0.0.1:5000/admin/` to log in and mint user keys. If it breaks, you get to keep both pieces.

## What it does

- Admin UI at `/admin/` to toggle/rotate user-facing keys and mint new ones when you need to share access.
- Normal API calling through `/api/proxy/chat/completions`; it hides your real key and does the auth header juggling for you.
- Per-key request/token limits so runaway scripts get throttled; usage stats so you can see who's noisy.
- Chat front-end with modes: normal and precise for everyday stuff, turbo when you want speed over cost, and "ultimate" (invite-only) if you're testing the spicy model. You can pick the upstream model per call.
- Experimental search tab that just exercises Hack Club's new search API.

## Quick call

```bash
curl http://127.0.0.1:5000/api/proxy/chat/completions \
  -H "Authorization: Bearer sk_YOUR_USER_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "ping"}]}'
```

The proxy picks an enabled provider key, forwards, logs, and echoes the response back.