import { Router } from 'express';
import { db } from '../db.js';
import { requireParent, newId, nowIso } from '../auth.js';
import { wrap, str, bad, notFound } from '../http.js';

// mergeParams so :familyId set by the parent router is visible here.
export const router = Router({ mergeParams: true });

const mapChild = (c) => ({
  id: c.id,
  name: c.name,
  birthdate: c.birthdate,
  colour: c.colour,
  notes: c.notes,
  archived: !!c.archived,
});

router.get('/', (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const rows = db.prepare(`
    SELECT * FROM children
     WHERE family_id = ? ${includeArchived ? '' : 'AND archived = 0'}
     ORDER BY archived, name
  `).all(req.familyId);
  res.json({ children: rows.map(mapChild) });
});

router.post('/', requireParent, wrap(async (req, res) => {
  const name = str(req.body.name, 'Name', { max: 80 });
  const birthdate = req.body.birthdate ? str(req.body.birthdate, 'Birthdate', { max: 10 }) : null;
  if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) bad('Birthdate must be YYYY-MM-DD');
  const colour = str(req.body.colour ?? '#5b8def', 'Colour', { max: 9 });
  const notes = str(req.body.notes ?? '', 'Notes', { max: 2000, required: false });

  const id = newId();
  db.prepare(`
    INSERT INTO children (id, family_id, name, birthdate, colour, notes, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, req.familyId, name, birthdate, colour, notes, nowIso());

  res.status(201).json({ child: mapChild(db.prepare('SELECT * FROM children WHERE id = ?').get(id)) });
}));

router.patch('/:childId', requireParent, wrap(async (req, res) => {
  const existing = db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?')
    .get(req.params.childId, req.familyId);
  if (!existing) notFound('Child not found');

  const name = req.body.name !== undefined ? str(req.body.name, 'Name', { max: 80 }) : existing.name;
  const birthdate = req.body.birthdate !== undefined
    ? (req.body.birthdate ? str(req.body.birthdate, 'Birthdate', { max: 10 }) : null)
    : existing.birthdate;
  const colour = req.body.colour !== undefined ? str(req.body.colour, 'Colour', { max: 9 }) : existing.colour;
  const notes = req.body.notes !== undefined
    ? str(req.body.notes, 'Notes', { max: 2000, required: false }) : existing.notes;
  const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : existing.archived;

  db.prepare(`
    UPDATE children SET name=?, birthdate=?, colour=?, notes=?, archived=? WHERE id=?
  `).run(name, birthdate, colour, notes, archived, existing.id);

  res.json({ child: mapChild(db.prepare('SELECT * FROM children WHERE id = ?').get(existing.id)) });
}));

// Hard delete removes the child's logged history too, so the UI offers archive
// as the default and reserves this for genuine mistakes.
router.delete('/:childId', requireParent, (req, res) => {
  const existing = db.prepare('SELECT id FROM children WHERE id = ? AND family_id = ?')
    .get(req.params.childId, req.familyId);
  if (!existing) return res.status(404).json({ error: 'Child not found' });
  db.prepare('DELETE FROM children WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});
