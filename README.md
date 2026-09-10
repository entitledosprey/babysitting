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

The image is built and published by GitHub Actions to
`ghcr.io/entitledosprey/babysitting` for `linux/amd64` and `linux/arm64` on every
push to `main`.

On the host:

```bash
docker compose pull && docker compose up -d
```

The container binds to `127.0.0.1:8080` only; nginx terminates TLS in front of
it. Install the vhost and issue the certificate:

```bash
sudo cp nginx/babysitting.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/babysitting.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d babysitting.entitledosprey.com
```

Data lives in the `babysitting-data` volume. To back it up:

```bash
docker compose exec app node -e "
  const {DatabaseSync}=require('node:sqlite');
  new DatabaseSync(process.env.DB_PATH).exec(\"VACUUM INTO '/app/data/backup.db'\")"
docker compose cp app:/app/data/backup.db ./backup-$(date +%F).db
```

## Accounts

The first person to register creates a family and becomes its parent. Parents
add children and generate invite codes from family settings; a sitter enters the
code when creating their account. Codes are single-use and expire after 14 days.
