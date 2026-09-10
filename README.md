# Sitter Log

A childcare logging app built around an hourly timeline. A sitter logs feedings,
naps, diapers, activities and observations in a couple of taps while holding a
child, and the app produces a Daily Childcare Report for the parents at the end
of the session.

- **Hourly timeline** — colour-coded blocks, point-in-time entries and duration
  blocks side by side, a live "now" line, and overlapping entries laid out in
  lanes.
- **One-tap sleep tracking** — Start Nap → running banner with a stopwatch →
  Wake Up, producing an exact block (`1:12 PM → 2:48 PM · 1 hr 36 min`).
- **16 entry types** — feeding, bottle, snack, water, diaper, potty, nap,
  medication, activity, bath, photo, note, incident, quiet time, screen time and
  milestones.
- **End-of-day report** — sleep, food, diapers and potty, activities, health and
  observations, per child, viewable in the app or shareable as plain text.
- **Multiple families and children** — a user can belong to several families;
  parents manage the roster and invite sitters with a one-time code.

## Stack

Deliberately dependency-light. The server is Express with `cookie-parser` and
nothing else — SQLite is Node's built-in `node:sqlite` (no native compilation)
and password hashing is `scrypt` from `node:crypto`. The frontend is React +
TypeScript + Vite with hand-written CSS, no component or state library.

```
Internet :443
  └─ nginx (host)          babysitting.entitledosprey.com
       └─ 127.0.0.1:8080
            └─ container   ghcr.io/entitledosprey/babysitting
                 ├─ Express API  /api/*
                 ├─ static SPA   /*
                 └─ SQLite       /app/data/babysitting.db
```

## Local development

Two terminals:

```bash
cd server && npm install && npm run dev      # API on :8080
cd web    && npm install && npm run dev      # UI on :5173, proxies /api
```

Or run the whole thing as one process the way production does:

```bash
cd web    && npm run build                   # builds into server/public
cd server && npm start                       # http://localhost:8080
```

Set `SECURE_COOKIES=false` when running over plain HTTP locally, otherwise the
session cookie is marked `Secure` and the browser will drop it.

### Tests

```bash
cd server && node --test test/api.test.mjs
```

The suite covers the event and report logic and, deliberately, the multi-tenant
boundary — a user in one family must get a 404 on every read and write path
belonging to another.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `./data/babysitting.db` | SQLite file; `:memory:` for throwaway runs |
| `STATIC_DIR` | `../public` relative to `src/` | Built frontend; API-only if absent |
| `SECURE_COOKIES` | `true` | Set `false` for plain-HTTP local use |

## Deployment

Live at **https://babysitting.entitledosprey.com**.

GitHub Actions builds and publishes `ghcr.io/entitledosprey/babysitting` for
`linux/amd64` and `linux/arm64` on every push to `main`. The package is public;
the repository is private.

### Topology

The deployment host already runs an nginx container that owns `:80` and `:443`
for another site. Rather than fight over the ports, this app joins that
container's Docker network and is reached by container name:

```
Cloudflare (proxied, Full strict)
  └─ :443  calorie-app-nginx-1          shared edge proxy
       ├─ calories.entitledosprey.com   → app:8000
       └─ babysitting.entitledosprey.com
            └─ http://babysitting:8080  over calorie-app_default
                 └─ SQLite at /app/data (babysitting-data volume)
```

The compose service is deliberately named `babysitting` rather than `app`: the
service name becomes a DNS alias on the shared network, and `app` is already
taken there.

### Updating

```bash
cd /opt/babysitting
docker compose pull && docker compose up -d
```

### First-time setup on the host

```bash
# 1. Certificate, issued over DNS-01 because the hostname is proxied by
#    Cloudflare and HTTP-01 cannot reach the origin.
sudo apt install python3-certbot-dns-cloudflare
sudo install -d -m 700 /root/.secrets
printf 'dns_cloudflare_api_token = %s\n' "$TOKEN" | sudo tee /root/.secrets/cloudflare.ini
sudo chmod 600 /root/.secrets/cloudflare.ini
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d babysitting.entitledosprey.com

# 2. Renewal hook: republishes the cert into the edge proxy's volume and
#    reloads it. certbot's live/ entries are symlinks into archive/, which is
#    not present inside that volume, so the hook dereferences them.
sudo cp nginx/babysitting-certs-hook.sh \
  /etc/letsencrypt/renewal-hooks/deploy/babysitting-certs.sh
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/babysitting-certs.sh
sudo RENEWED_LINEAGE=/etc/letsencrypt/live/babysitting.entitledosprey.com \
  /etc/letsencrypt/renewal-hooks/deploy/babysitting-certs.sh

# 3. Server block, appended to the edge proxy's config.
cat nginx/babysitting.conf >> /home/ubuntu/calorie-app/nginx/nginx.conf
docker exec calorie-app-nginx-1 nginx -t
docker exec calorie-app-nginx-1 nginx -s reload

# 4. The app itself.
cd /opt/babysitting && docker compose up -d
```

The zone's SSL/TLS mode must be **Full (strict)** — the server block redirects
`:80` to `:443`, so Flexible mode would produce a redirect loop.

`nginx/babysitting.conf` inlines Cloudflare's IP ranges and reads
`CF-Connecting-IP`, scoped to that server block so the neighbouring site is
unaffected. Without it every visitor shares one address and the login rate
limiter collapses into a single global bucket. Re-run
`scripts/update-cloudflare-ips.sh` if Cloudflare changes its published ranges.

### Backups

Data lives in the `babysitting-data` volume:

```bash
docker compose exec babysitting node -e "
  const {DatabaseSync}=require('node:sqlite');
  new DatabaseSync(process.env.DB_PATH).exec(\"VACUUM INTO '/app/data/backup.db'\")"
docker compose cp babysitting:/app/data/backup.db ./backup-$(date +%F).db
```

## Accounts

The first person to register creates a family and becomes its parent. Parents
add children and generate invite codes from family settings; a sitter enters the
code when creating their account. Codes are single-use and expire after 14 days.
