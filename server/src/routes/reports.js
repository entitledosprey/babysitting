import { Router } from 'express';
import { db } from '../db.js';
import { wrap } from '../http.js';
import { loadShift, childrenOfShift, eventsOf } from '../access.js';
import { buildReport, renderReportText } from '../report.js';

/** Mounted at /api/shifts/:shiftId */
export const router = Router({ mergeParams: true });

/** Both the sitter and the client's parents may read a report. */
export const reportFor = (shiftId, user) => {
  const { shift, client } = loadShift(shiftId, user);
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(shift.business_id);
  return buildReport(shift, childrenOfShift(shift.id), eventsOf(shift.id), {
    sitterName: db.prepare('SELECT name FROM users WHERE id = ?').get(shift.sitter_user_id)?.name ?? '',
    clientName: client.name,
    businessName: business?.name ?? '',
  });
};

router.get('/report', wrap(async (req, res) => {
  res.json({ report: reportFor(req.params.shiftId, req.user) });
}));

router.get('/report.txt', wrap(async (req, res) => {
  res.type('text/plain; charset=utf-8').send(renderReportText(reportFor(req.params.shiftId, req.user)));
}));
