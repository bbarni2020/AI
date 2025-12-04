# AI Gateway

A dead-simple Flask proxy I threw together to stop managing a dozen API keys across projects. Sits between your apps and Hack Club's AI service, keeps your actual API key hidden, and lets you spin up throwaway keys for different projects or services.

Rate limiting's built in so you won't accidentally torch your quota or rack up surprise bills. Also gives you a quick dashboard to see what's actually using your API key and how much.

Nothing fancy, but it works.

## What's in the box?

- **Admin Dashboard**: A simple, no-frills web UI to manage your keys. Find it at `/admin/`.
- **Key Management**: Create, edit, and delete user-facing API keys. You can enable/disable them on the fly.
- **Rate Limiting**: Set limits per minute and per day for both requests and tokens. Helps prevent runaway scripts from causing trouble.
- **Usage Stats**: See total requests and tokens used for each key, plus some basic daily usage graphs.
- **Proxy Endpoint**: A single endpoint (`/api/proxy/chat/completions`) that routes requests to the upstream API using your provider keys in rotation.

## Getting Started

I've tried to make this pretty straightforward.

**1. Clone & Setup:**

First, grab the code and set up a Python virtual environment.

```bash
git clone https://github.com/bbarni2020/AI.git
cd AI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**2. Configure:**

There's a `.env.example` file. Copy it and fill it out.

```bash
cp .env.example .env
# Now open .env in your editor and set your own values
```

You'll definitely want to set `ADMIN_USER` and `ADMIN_PASS` to something other than the defaults. You'll also need to provide your upstream provider API key in `UPSTREAM_API_KEY`.

**3. Run it:**

I included a simple shell script to get the server running.

```bash
./run.sh
```

This will start the Waitress server. You should be able to access the admin panel at `http://127.0.0.1:5000/admin/`.

## Using the Proxy

Once it's running, you can send your API requests to your proxy server instead of directly to the AI provider. Just make sure to use one of the user keys you created in the admin dashboard for authentication.

Here’s a quick `curl` example:

```bash
curl http://127.0.0.1:5000/api/proxy/chat/completions \
  -H "Authorization: Bearer sk_YOUR_USER_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello, world!"}]
  }'
```

The proxy will pick one of your enabled provider keys, send the request upstream, log the usage, and then pass the response back to you.