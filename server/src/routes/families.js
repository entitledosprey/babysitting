import { Router } from 'express';
import { db } from '../db.js';
import { requireFamily, requireParent, newId, nowIso } from '../auth.js';
import { wrap, str, bad, notFound } from '../http.js';
import { makeInviteCode } from './auth.js';
import { router as childrenRouter } from './children.js';

export const router = Router();

const INVITE_DAYS = 14;
const familyGuard = requireFamily((req) => req.params.familyId);

router.get('/', (req, res) => {
  res.json({
    families: db.prepare(`
      SELECT f.id, f.name, m.role,
             (SELECT COUNT(*) FROM children c WHERE c.family_id = f.id AND c.archived = 0) AS childCount
        FROM memberships m JOIN families f ON f.id = m.family_id
       WHERE m.user_id = ?
       ORDER BY f.name
    `).all(req.user.id),
  });
});

router.post('/', wrap(async (req, res) => {
  const name = str(req.body.name, 'Family name', { max: 100 });
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO families (id,name,created_at) VALUES (?,?,?)').run(id, name, now);
  db.prepare('INSERT INTO memberships (user_id,family_id,role,created_at) VALUES (?,?,?,?)')
    .run(req.user.id, id, 'parent', now);
  res.status(201).json({ family: { id, name, role: 'parent', childCount: 0 } });
}));

router.patch('/:familyId', familyGuard, requireParent, wrap(async (req, res) => {
  const name = str(req.body.name, 'Family name', { max: 100 });
  db.prepare('UPDATE families SET name = ? WHERE id = ?').run(name, req.familyId);
  res.json({ family: { id: req.familyId, name, role: req.role } });
}));

router.get('/:familyId/members', familyGuard, (req, res) => {
  res.json({
    members: db.prepare(`
      SELECT u.id, u.name, u.email, m.role, m.created_at AS joinedAt
        FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.family_id = ?
       ORDER BY m.role, u.name
    `).all(req.familyId),
  });
});

router.delete('/:familyId/members/:userId', familyGuard, requireParent, wrap(async (req, res) => {
  const { userId } = req.params;
  if (userId === req.user.id) bad('You cannot remove yourself from a family');
  const target = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND family_id = ?')
    .get(userId, req.familyId);
  if (!target) notFound('That person is not in this family');
  db.prepare('DELETE FROM memberships WHERE user_id = ? AND family_id = ?').run(userId, req.familyId);
  res.json({ ok: true });
}));

// --- Invites -----------------------------------------------------------------

router.get('/:familyId/invites', familyGuard, requireParent, (req, res) => {
  res.json({
    invites: db.prepare(`
      SELECT code, role, expires_at AS expiresAt, created_at AS createdAt
        FROM invites
       WHERE family_id = ? AND used_by IS NULL AND expires_at > ?
       ORDER BY created_at DESC
    `).all(req.familyId, nowIso()),
  });
});

router.post('/:familyId/invites', familyGuard, requireParent, wrap(async (req, res) => {
  const role = str(req.body.role ?? 'sitter', 'Role', { max: 10 });
  if (role !== 'sitter' && role !== 'parent') bad('Role must be sitter or parent');

  const code = makeInviteCode();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  db.prepare(`
    INSERT INTO invites (code, family_id, role, created_by, expires_at, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(code, req.familyId, role, req.user.id, expiresAt, now);

  res.status(201).json({ invite: { code, role, expiresAt, createdAt: now } });
}));

router.delete('/:familyId/invites/:code', familyGuard, requireParent, (req, res) => {
  db.prepare('DELETE FROM invites WHERE code = ? AND family_id = ? AND used_by IS NULL')
    .run(req.params.code.toUpperCase(), req.familyId);
  res.json({ ok: true });
});

router.use('/:familyId/children', familyGuard, childrenRouter);
