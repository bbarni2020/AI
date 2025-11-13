# AI Proxy Dashboard (Flask)

A small Flask app that proxies API-keyed requests to an upstream AI API and provides a secure admin dashboard to manage provider API keys with per-minute and per-day token limits.

## Features

- Session-authenticated admin dashboard (static HTML) at `/admin/`
- CRUD for provider keys (enable/disable, rate/min, tokens/day)
- Proxy endpoint: `POST /api/proxy/chat/completions`
- Per-key rotation with limits and simple usage logging
- Production WSGI server via Waitress

## Configure

Copy `.env.example` to `.env` and fill values:

- FLASK_SECRET_KEY
- ADMIN_USER, ADMIN_PASS
- PROXY_AUTH_TOKEN
- DATABASE_URL (default `sqlite:///data.db`)
- UPSTREAM_URL (default `https://ai.hackclub.com/proxy/v1`)
- HOST, PORT, THREADS (for the server)

## Install (Windows PowerShell)

```powershell
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

## Run (production)

```powershell
. .venv\Scripts\Activate.ps1
python serve.py
```

Open http://127.0.0.1:5000/admin/

## Run (development)

```powershell
. .venv\Scripts\Activate.ps1
$env:FLASK_DEBUG=1
python -m flask --app wsgi run
```

## Proxy usage

Send client requests to your proxy, using the token you set in `PROXY_AUTH_TOKEN`:

```powershell
$body = '{"model": "qwen/qwen3-32b", "messages": [{"role":"user","content":"Hello"}]}'
Invoke-RestMethod -Uri http://127.0.0.1:5000/api/proxy/chat/completions -Method Post -Headers @{Authorization="Bearer YOUR_PROXY_TOKEN"} -ContentType 'application/json' -Body $body
```

Provider keys are stored only on your server and rotated according to limits.
