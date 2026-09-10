import { Router } from 'express';
import { db } from '../db.js';
import { wrap } from '../http.js';
import { loadSession, childrenOf, eventsOf } from '../access.js';
import { buildReport, renderReportText } from '../report.js';

/** Mounted at /api/sessions/:sessionId */
export const router = Router({ mergeParams: true });

const reportFor = (sessionId, userId) => {
  const { session } = loadSession(sessionId, userId);
  const meta = {
    sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(session.sitter_user_id)?.name ?? '',
    familyName: db.prepare('SELECT name FROM families WHERE id = ?').get(session.family_id)?.name ?? '',
  };
  return buildReport(session, childrenOf(session.id), eventsOf(session.id), meta);
};

router.get('/report', wrap(async (req, res) => {
  res.json({ report: reportFor(req.params.sessionId, req.user.id) });
}));

router.get('/report.txt', wrap(async (req, res) => {
  const report = reportFor(req.params.sessionId, req.user.id);
  res.type('text/plain; charset=utf-8').send(renderReportText(report));
}));
