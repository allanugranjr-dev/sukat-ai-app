# Deploying SukatAI for free (GitHub Student Pack)

This guide deploys the **whole real app** — React frontend, Node API, MariaDB,
and the Python AI measurement service — onto **one DigitalOcean droplet**, with a
free **Namecheap** domain. Both are free from the **GitHub Student Developer Pack**:

- **DigitalOcean** → **$200 credit** (≈ 8–16 months of a small droplet). This is
  the hosting. One server runs everything, including the Python AI engine that
  shared hosting (cPanel) cannot run.
- **Namecheap** → a **free `.me` domain for 1 year**. This is just the address.

> "Free" here means *free via the pack's credit for ~a year*, which covers a
> thesis timeline. There is no host that runs the ML engine free forever.

## Architecture (one droplet)

```
Internet ──HTTPS──> Caddy (:443, auto Let's Encrypt)
                      └─ reverse proxy ─> Node server (127.0.0.1:3001)
                                            ├─ serves the built frontend (dist-node) + API
                                            ├─ MariaDB (127.0.0.1:3306)
                                            └─ calls Python AI service (127.0.0.1:8000)
```

Node and the AI service bind to localhost only; Caddy is the single public door
and gives you free HTTPS automatically.

## Prerequisites

- A GitHub account with the Student Pack approved (education.github.com/pack).
- Basic terminal/SSH comfort. On Windows use PowerShell or Git Bash for `ssh`.

## Part A — Claim the free offers

1. **DigitalOcean credit:** education.github.com/pack → search **DigitalOcean** →
   **Get access** → copy the $200 promo code. Create a DigitalOcean account, then
   **Billing → add the promo code**. (A card may be required for verification; the
   credit covers the cost.)
2. **Namecheap domain:** same pack page → **Namecheap** → claim your free `.me`
   domain and register it.

## Part B — Create the droplet

1. DigitalOcean → **Create → Droplets**.
2. Image: **Ubuntu 24.04 LTS** (ships Python 3.12, which the AI engine needs).
3. Plan: **Basic → Regular → 2 GB RAM / 1 CPU** (~$12/mo; resize up to 4 GB later
   if the AI service is sluggish).
4. Authentication: **SSH key** (paste your public key — safer than a password).
5. Create, then note the droplet's **public IP**.
6. Connect: `ssh root@YOUR_DROPLET_IP`

## Part C — Point the domain at the droplet

In Namecheap → **Domain List → Manage → Advanced DNS**, add:

| Type | Host | Value            | TTL  |
|------|------|------------------|------|
| A    | `@`  | YOUR_DROPLET_IP  | Auto |
| A    | `www`| YOUR_DROPLET_IP  | Auto |

DNS can take a few minutes to an hour to propagate.

## Part D — Provision the server

Run these on the droplet (as root). Replace placeholders in ALL-CAPS.

### D1. System packages

```bash
apt update && apt upgrade -y
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git mariadb-server python3 python3-venv python3-pip \
  libgl1 libglib2.0-0          # libs MediaPipe/OpenCV need at runtime
# Caddy (HTTPS reverse proxy)
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### D2. Get the code

```bash
useradd -m -s /bin/bash sukatai || true
git clone https://github.com/allanugranjr-dev/sukat-ai-app.git /opt/sukatai
chown -R sukatai:sukatai /opt/sukatai
```

### D3. Database (least-privilege user, not root)

```bash
mysql_secure_installation      # set a root password, answer the prompts
mysql -u root -p <<'SQL'
CREATE DATABASE sukatai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sukatai'@'localhost' IDENTIFIED BY 'STRONG_DB_PASSWORD';
GRANT ALL PRIVILEGES ON sukatai.* TO 'sukatai'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### D4. Server-only environment file

Create `/opt/sukatai/.env.node.local` (git-ignored; the Node app loads it):

```dotenv
NODE_ENV=production
PORT=3001
SUKATAI_DB_HOST=127.0.0.1
SUKATAI_DB_PORT=3306
SUKATAI_DB_NAME=sukatai
SUKATAI_DB_USER=sukatai
SUKATAI_DB_PASS=STRONG_DB_PASSWORD
RECONSTRUCTION_PROVIDER=ai-service
RECONSTRUCTION_API_URL=http://127.0.0.1:8000
AI_SERVICE_API_KEY=A_LONG_RANDOM_SHARED_SECRET
RECONSTRUCTION_TIMEOUT_MS=600000
SUKATAI_PUBLIC_APP_URL=https://YOURDOMAIN.me
SUKATAI_WEB_ORIGINS=https://YOURDOMAIN.me
SUKATAI_TRUST_PROXY=true
# Optional email (Gmail App Password) — see root README for setup:
# SUKATAI_SMTP_HOST=smtp.gmail.com
# SUKATAI_SMTP_PORT=587
# SUKATAI_SMTP_USER=you@gmail.com
# SUKATAI_SMTP_PASS=your-16-char-app-password
# SUKATAI_EMAIL_FROM=SukatAI <you@gmail.com>
```

> Production refuses to start without `SUKATAI_DB_PASS`. `SUKATAI_TRUST_PROXY=true`
> is correct because Caddy sits in front. Cookies become Secure automatically.

### D5. Build the frontend + prepare the database

```bash
cd /opt/sukatai
sudo -u sukatai npm ci
sudo -u sukatai npm run build:node     # outputs dist-node/ (served by Node)
sudo -u sukatai npm run node:setup     # applies the MariaDB schema
```

### D6. Python AI measurement service

Ubuntu 24.04's `python3` is 3.12, so the full fitter (clad-body + anny) installs:

```bash
cd /opt/sukatai/ai-service
sudo -u sukatai python3 -m venv .venv
sudo -u sukatai .venv/bin/pip install --upgrade pip
sudo -u sukatai .venv/bin/pip install -r requirements.txt
# Model assets: canonical_human_weights.npz is already in the repo.
# Download the MediaPipe pose model and see MODEL_SETUP.md for the rest:
sudo -u sukatai .venv/bin/python scripts/download_pose_model.py
```

### D7. Run both as services (systemd)

`/etc/systemd/system/sukatai-ai.service`:

```ini
[Unit]
Description=SukatAI AI measurement service
After=network.target

[Service]
User=sukatai
WorkingDirectory=/opt/sukatai/ai-service
Environment=AI_SERVICE_API_KEY=A_LONG_RANDOM_SHARED_SECRET
ExecStart=/opt/sukatai/ai-service/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/sukatai-node.service`:

```ini
[Unit]
Description=SukatAI Node server
After=network.target mariadb.service sukatai-ai.service

[Service]
User=sukatai
WorkingDirectory=/opt/sukatai
ExecStart=/usr/bin/node server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now sukatai-ai sukatai-node
```

### D8. HTTPS with Caddy

Replace `/etc/caddy/Caddyfile` with (uses your real domain):

```caddyfile
YOURDOMAIN.me, www.YOURDOMAIN.me {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy fetches a free Let's Encrypt certificate automatically once DNS points at
the droplet. The Node server already serves both the frontend and the API, so a
single reverse-proxy line covers everything.

> `AI_SERVICE_API_KEY` must be the **same value** in `.env.node.local` and the
> `sukatai-ai.service` unit, or the Node server can't call the AI engine.

## Part E — Verify

```bash
systemctl status sukatai-ai sukatai-node caddy   # all "active (running)"
curl -s http://127.0.0.1:8000/health             # AI service up (if a health route exists)
journalctl -u sukatai-node -n 50 --no-pager      # Node logs
```

Then open `https://YOURDOMAIN.me` in a browser — you should get the app over
HTTPS. Create an account and run a scan to confirm the AI pipeline works end to end.

## Part F — Shipping updates

Manual redeploy after pushing to `main`:

```bash
cd /opt/sukatai
sudo -u sukatai git pull
sudo -u sukatai npm ci
sudo -u sukatai npm run build:node
sudo -u sukatai npm run node:setup          # only if the schema changed
systemctl restart sukatai-node sukatai-ai
```

**Optional — auto-deploy on push.** Add an SSH deploy key as a GitHub Actions
secret and a workflow step that SSHes in and runs the commands above, so every
push to `main` redeploys. Ask and I'll generate the workflow once the droplet
exists.

## Troubleshooting

- **Site won't get HTTPS:** DNS A record must point at the droplet IP and have
  propagated; check `journalctl -u caddy`.
- **Node won't start:** usually a missing `SUKATAI_DB_PASS` or wrong DB creds —
  see `journalctl -u sukatai-node`.
- **Scans fail / AI engine down:** `journalctl -u sukatai-ai`. On a 2 GB droplet
  the ML libraries can be memory-tight — resize to 4 GB in DigitalOcean if it
  gets OOM-killed. First fit is slow on CPU (minutes); that's expected.
- **AI calls rejected:** `AI_SERVICE_API_KEY` mismatch between the two services.

## Cost / credit

A 2 GB droplet is ~$12/mo, so the **$200 credit lasts ~16 months**. Watch usage
in DigitalOcean → Billing. To cut cost further, you can host the static frontend
free on Cloudflare Pages and keep only the backend + AI service on the droplet —
ask if you want that split instead.






