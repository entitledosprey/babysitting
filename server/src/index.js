import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { pruneExpired } from './db.js';
import { loadUser, requireAuth, requireAdmin } from './auth.js';
import { HttpError } from './http.js';
import { EVENT_TYPES } from './types.js';

import { router as authRouter } from './routes/auth.js';
import { router as businessRouter } from './routes/business.js';
import { router as clientsRouter } from './routes/clients.js';
import { router as shiftsRouter } from './routes/shifts.js';
import { shiftRouter as shiftEventsRouter, router as eventsRouter } from './routes/events.js';
import { router as reportsRouter } from './routes/reports.js';
import { router as invoicesRouter } from './routes/invoices.js';
import { router as adminRouter } from './routes/admin.js';

const PORT = Number(process.env.PORT) || 8080;
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR || join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1); // behind nginx; needed for correct req.ip rate limiting
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(loadUser);

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/api/event-types', (_req, res) => res.json({ types: EVENT_TYPES }));

app.use('/api/auth', authRouter);

// Every route below resolves access through access.js: the sitter who owns the
// business gets read and write, a parent granted a client gets read only, and
// anyone else gets 404 so record ids cannot be probed.
app.use('/api/business', requireAuth, businessRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/shifts/:shiftId/events', requireAuth, shiftEventsRouter);
app.use('/api/shifts/:shiftId', requireAuth, reportsRouter);
app.use('/api/shifts', requireAuth, shiftsRouter);
app.use('/api/events', requireAuth, eventsRouter);
app.use('/api/invoices', requireAuth, invoicesRouter);
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// --- Static SPA --------------------------------------------------------------

if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR, {
    index: false,
    setHeaders(res, path) {
      // Vite emits content-hashed asset names, so they can cache hard; the
      // shell must not, or a deploy leaves clients on the old bundle.
      if (path.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (_req, res) => res.sendFile(join(STATIC_DIR, 'index.html')));
}

// --- Errors ------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong' });
});

pruneExpired();
setInterval(pruneExpired, 3600_000).unref();

app.listen(PORT, () => {
  console.log(`babysitting-log listening on :${PORT}`);
  if (!existsSync(STATIC_DIR)) console.log(`(no static build at ${STATIC_DIR} — API only)`);
});
