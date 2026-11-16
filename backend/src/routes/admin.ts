import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { idemKey, parse, requireAuth } from '../middleware';
import { notFound } from '../lib/errors';
import { createUser, publicUser } from '../services/auth';
import { checkLedger } from '../services/ledger';
import * as pay from '../services/payments';

export const adminRouter = Router();
adminRouter.use(requireAuth('admin'));

const amount = z.coerce.number().int().positive().max(1_000_000_000);

adminRouter.get('/stats', async (_req, res) => {
  const [users, volume, revenue, emoney, kyc] = await Promise.all([
    pool.query(`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role`),
    pool.query(
      `SELECT type, COUNT(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS volume FROM transactions
        WHERE created_at >= now() - interval '30 days' AND status = 'completed' GROUP BY type`,
    ),
    pool.query(`SELECT COALESCE(SUM(balance),0)::bigint AS v FROM accounts WHERE type = 'fee_revenue'`),
    pool.query(`SELECT COALESCE(SUM(balance),0)::bigint AS v FROM accounts WHERE type = 'wallet'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM kyc_submissions WHERE status = 'pending'`),
  ]);
  const daily = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS volume
       FROM transactions WHERE created_at >= now() - interval '14 days' AND status = 'completed'
      GROUP BY 1 ORDER BY 1`,
  );
  res.json({
    usersByRole: Object.fromEntries(users.rows.map((r) => [r.role, r.n])),
    last30Days: volume.rows.map((r) => ({ type: r.type, count: r.n, volume: Number(r.volume) })),
    daily: daily.rows.map((r) => ({ day: r.day, count: r.n, volume: Number(r.volume) })),
    feeRevenue: Number(revenue.rows[0].v),
    walletsTotal: Number(emoney.rows[0].v),
    pendingKyc: kyc.rows[0].n,
  });
});

adminRouter.get('/users', async (req, res) => {
  const q = parse(
    z.object({ search: z.string().optional(), role: z.enum(['customer', 'agent', 'merchant', 'admin']).optional(), limit: z.coerce.number().int().max(200).default(50) }),
    req.query,
  );
  const { rows } = await pool.query(
    `SELECT u.*, a.balance FROM users u LEFT JOIN accounts a ON a.owner_id = u.id AND a.type = 'wallet'
      WHERE ($1::text IS NULL OR u.phone ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%' OR u.public_code ILIKE '%' || $1 || '%')
        AND ($2::user_role IS NULL OR u.role = $2)
      ORDER BY u.created_at DESC LIMIT $3`,
    [q.search ?? null, q.role ?? null, q.limit],
  );
  res.json({ items: rows.map((r) => ({ ...publicUser(r), balance: r.balance ?? 0 })) });
});

adminRouter.post('/users', async (req, res) => {
  const b = parse(
    z.object({
      phone: z.string(), fullName: z.string().min(2), pin: z.string(),
      role: z.enum(['customer', 'agent', 'merchant', 'admin']), businessName: z.string().optional(),
    }),
    req.body,
  );
  const u = await createUser(b);
  await pay.audit(pool, req.auth!.sub, 'user.create', u.id, { role: b.role });
  res.status(201).json(publicUser(u));
});

adminRouter.patch('/users/:id', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['active', 'blocked']).optional(), kycLevel: z.number().int().min(0).max(2).optional() }), req.body);
  const { rows } = await pool.query(
    `UPDATE users SET status = COALESCE($2, status), kyc_level = COALESCE($3, kyc_level),
       failed_pin_attempts = CASE WHEN $2 = 'active' THEN 0 ELSE failed_pin_attempts END
     WHERE id = $1 RETURNING *`,
    [req.params.id, b.status ?? null, b.kycLevel ?? null],
  );
  if (!rows[0]) throw notFound('Utilisateur introuvable');
  await pay.audit(pool, req.auth!.sub, 'user.update', rows[0].id, b);
  res.json(publicUser(rows[0]));
});

adminRouter.get('/kyc', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }), req.query);
  const { rows } = await pool.query(
    `SELECT k.*, u.full_name, u.phone, u.kyc_level FROM kyc_submissions k JOIN users u ON u.id = k.user_id
      WHERE k.status = $1 ORDER BY k.created_at LIMIT 200`,
    [q.status],
  );
  res.json({ items: rows });
});

adminRouter.post('/kyc/:id/review', async (req, res) => {
  const b = parse(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }), req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE kyc_submissions SET status = $2, review_note = $3, reviewer_id = $4, reviewed_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id, b.decision, b.note ?? null, req.auth!.sub],
    );
    if (!rows[0]) throw notFound('Demande KYC introuvable ou déjà traitée');
    if (b.decision === 'approved') {
      await client.query(`UPDATE users SET kyc_level = GREATEST(kyc_level, 1) WHERE id = $1`, [rows[0].user_id]);
    }
    await pay.audit(client, req.auth!.sub, `kyc.${b.decision}`, rows[0].user_id, { submission: rows[0].id });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

adminRouter.get('/transactions', async (req, res) => {
  const q = parse(z.object({ search: z.string().optional(), type: z.string().optional(), limit: z.coerce.number().int().max(200).default(50) }), req.query);
  const { rows } = await pool.query(
    `SELECT t.*, fu.full_name AS from_name, fu.phone AS from_phone, tu.full_name AS to_name, tu.phone AS to_phone
       FROM transactions t
       LEFT JOIN users fu ON fu.id = t.from_user_id
       LEFT JOIN users tu ON tu.id = t.to_user_id
      WHERE ($1::text IS NULL OR t.reference ILIKE '%' || $1 || '%' OR fu.phone ILIKE '%' || $1 || '%' OR tu.phone ILIKE '%' || $1 || '%')
        AND ($2::tx_type IS NULL OR t.type = $2)
      ORDER BY t.created_at DESC LIMIT $3`,
    [q.search ?? null, q.type ?? null, q.limit],
  );
  res.json({ items: rows });
});

adminRouter.post('/transactions/:id/reverse', async (req, res) => {
  const b = parse(z.object({ reason: z.string().min(3).max(200) }), req.body);
  res.status(201).json(await pay.reverse({ adminId: req.auth!.sub, transactionId: String(req.params.id), reason: b.reason }));
});

adminRouter.post('/float/issue', async (req, res) => {
  const b = parse(z.object({ agentPhone: z.string(), amount }), req.body);
  const r = await pay.issueFloat({ adminId: req.auth!.sub, ...b, idempotencyKey: idemKey(req) });
  res.status(r.replayed ? 200 : 201).json(r);
});

adminRouter.post('/float/redeem', async (req, res) => {
  const b = parse(z.object({ agentPhone: z.string(), amount }), req.body);
  const r = await pay.redeemFloat({ adminId: req.auth!.sub, ...b, idempotencyKey: idemKey(req) });
  res.status(r.replayed ? 200 : 201).json(r);
});

adminRouter.get('/ledger/check', async (_req, res) => {
  res.json(await checkLedger(pool));
});

adminRouter.get('/audit', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, u.full_name AS actor_name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 200`,
  );
  res.json({ items: rows });
});
