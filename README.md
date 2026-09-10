# Sitter Log

Software for running a babysitting business. A sitter sets up the families they
work for, logs each shift on an hourly timeline, and the app emails the parents a
professional daily report the moment the shift is closed out.

- **Your clients** — a roster of the families you sit for, each with children,
  contacts, and a care profile: allergies, medical notes, routines, house rules,
  Wi-Fi, who may collect.
- **Shifts** — book ahead, start on arrival, log the day, close out. Scheduled →
  in progress → completed, with the status derived from the timestamps so the two
  can never disagree.
- **Hourly timeline** — colour-coded blocks, point-in-time entries and duration
  blocks side by side, a live "now" line, and overlapping entries laid out in
  lanes.
- **One-tap sleep tracking** — Start Nap → running banner with a stopwatch →
  Wake Up, producing an exact block (`1:12 PM → 2:48 PM · 1 hr 36 min`).
- **16 entry types** — feeding, bottle, snack, water, diaper, potty, nap,
  medication, activity, bath, photo, note, incident, quiet time, screen time and
  milestones.
- **Daily report, emailed automatically** — per child: sleep, food, diapers and
  potty, activities, health and observations. Sent to the contacts you flag,
  every time a shift ends.
- **Hours and invoicing** — billable hours come from actual logged shift
  durations at the client's rate, with a preview, line items, and an emailed
  invoice.
- **Parent portal** — parents can be given a read-only login to their own
  family's shifts and reports. They can see everything about their family and
  change nothing.
- **Admin console** at `/admin` — accounts, businesses, shifts, email delivery
  and database maintenance.

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
cd server && node --test test/*.test.mjs
```

49 tests across four suites:

- **api** — the shift lifecycle, report totals, invoicing maths, and
  deliberately the two access boundaries: a rival sitter gets 404 on every read
  and write path of another business, and a parent gets 403 on every write to
  their own family.
- **admin** — the admin gate is invisible to ordinary users, disabling revokes
  live sessions, password resets invalidate old ones, destructive actions are
  guarded.
- **mail** — runs a real in-process SMTP server and asserts that closing a shift
  delivers a multipart message to the opted-in contact and to nobody else, with
  the child's entries present in both the text and HTML parts.
- **mail-config** — the port/TLS pairing. Port 465 is forced secure regardless
  of `SMTP_SECURE`, mismatches are reported in the admin console, and opaque
  SMTP errors are rewritten to name the likely cause.

## Configuration

Copy `.env.example` to `.env` beside `docker-compose.yml` and fill it in.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `./data/babysitting.db` | SQLite file; `:memory:` for throwaway runs |
| `STATIC_DIR` | `../public` relative to `src/` | Built frontend; API-only if absent |
| `SECURE_COOKIES` | `true` | Set `false` for plain-HTTP local use |
| `ADMIN_EMAILS` | *(empty)* | Comma-separated emails granted the admin console |
| `APP_BASE_URL` | *(empty)* | Link target in report emails |
| `SMTP_HOST` | *(empty)* | Empty disables sending; the app degrades gracefully |
| `SMTP_PORT` | `587` | `587` STARTTLS, `465` implicit TLS |
| `SMTP_SECURE` | `false` | `true` only for port 465 |
| `SMTP_USER` / `SMTP_PASS` | *(empty)* | Omit both for an unauthenticated relay |
| `SMTP_FROM` | *(empty)* | Envelope sender; required for sending |

## Administration

`ADMIN_EMAILS` grants the console at `/admin`. The role is **not** a database
flag — it cannot be granted from inside the app, so taking over an account is not
enough to become an administrator. Non-admins get a 404 on every admin route, so
the surface is not discoverable.

The console covers an overview (counts, database size, uptime, mail status,
recent delivery failures), user search with password reset, disable and delete,
business inspection with a confirm-by-name delete, shift listing with report
resend, the email delivery log, and maintenance actions (backup, vacuum, prune).

Disabling an account revokes its live sessions immediately rather than waiting
for the token to expire. Deleting a sitter is refused unless forced, because it
cascades to their whole business — the refusal names how many clients and shifts
would go with them.

## Report emails

When a sitter closes out a shift, the report is rendered as text and HTML and
emailed to every contact on that client flagged `receivesReports`. Contacts are
records the sitter maintains, so this works whether or not the parents ever
create a portal login.

The send is fired without being awaited: SMTP can be slow or down, and closing a
shift must not depend on it. Every attempt is written to `email_log` as `sent`,
`failed` or `skipped`, so nothing is lost silently and the admin console can
retry. With `SMTP_HOST` unset the app runs normally and records `skipped`.

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

A sitter registers with a business name and owns everything under it. Parents do
not need accounts at all — they are contacts on a client, and reports reach them
by email. A sitter who wants to give parents a read-only login generates an
invite code from the client's People tab; codes are single-use and expire after
21 days.

Platform admins are named by `ADMIN_EMAILS` and may register without a business.

### Migrating from the family-rooted schema

The first release rooted everything at a family that parents owned. There is no
meaningful mapping from that to a business a sitter owns, so the migration keeps
logins and drops the domain data:

```bash
docker compose exec app node scripts/migrate-to-business.mjs        # dry run
docker compose exec app node scripts/migrate-to-business.mjs --yes  # do it
```

It writes a timestamped backup first. The app refuses to start against an
unmigrated database rather than running with a half-matching schema.
