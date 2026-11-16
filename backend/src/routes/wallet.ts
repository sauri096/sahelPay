import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { config } from '../config';
import { idemKey, parse, requireAuth } from '../middleware';
import { notFound } from '../lib/errors';
import { normalizePhone } from '../lib/phone';
import { publicUser } from '../services/auth';
import { getBalance } from '../services/ledger';
import * as pay from '../services/payments';

export const walletRouter = Router();

const amount = z.coerce.number().int().positive().max(100_000_000);
const pin = z.string();

walletRouter.get('/me', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.auth!.sub]);
  const user = publicUser(rows[0]);
  const balance = await getBalance(pool, user.id);
  const { rows: today } = await pool.query(
    `SELECT COALESCE(SUM(amount + fee), 0)::bigint AS total FROM transactions
      WHERE from_user_id = $1 AND status = 'completed' AND type IN ('transfer','cash_out','merchant_payment')
        AND created_at >= date_trunc('day', now())`,
    [user.id],
  );
  const limits = user.role === 'customer' ? config.limits[user.kycLevel] : null;
  res.json({
    user,
    wallet: { balance, currency: config.currency },
    limits: limits && { ...limits, usedToday: Number(today[0].total) },
    qr: user.role === 'agent' ? `SAHELPAY:A:${user.publicCode}`
      : user.role === 'merchant' ? `SAHELPAY:M:${user.publicCode}`
      : `SAHELPAY:U:${user.phone}`,
  });
});

walletRouter.get('/transactions', requireAuth(), async (req, res) => {
  const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().optional() }), req.query);
  const uid = req.auth!.sub;
  const { rows } = await pool.query(
    `SELECT t.id, t.reference, t.type, t.status, t.amount, t.fee, t.currency, t.description, t.created_at,
            t.from_user_id, t.to_user_id,
            fu.full_name AS from_name, fu.phone AS from_phone, fu.business_name AS from_business,
            tu.full_name AS to_name, tu.phone AS to_phone, tu.business_name AS to_business,
            le.amount AS net, le.balance_after
       FROM ledger_entries le
       JOIN accounts a ON a.id = le.account_id AND a.owner_id = $1 AND a.type = 'wallet'
       JOIN transactions t ON t.id = le.transaction_id
       LEFT JOIN users fu ON fu.id = t.from_user_id
       LEFT JOIN users tu ON tu.id = t.to_user_id
      WHERE ($2::timestamptz IS NULL OR t.created_at < $2)
      ORDER BY le.id DESC LIMIT $3`,
    [uid, q.before ?? null, q.limit],
  );
  res.json({
    items: rows.map((r) => {
      const outgoing = r.net < 0;
      const cpName = outgoing ? (r.to_business ?? r.to_name) : (r.from_business ?? r.from_name);
      const cpPhone = outgoing ? r.to_phone : r.from_phone;
      return {
        id: r.id, reference: r.reference, type: r.type, status: r.status,
        amount: r.amount, fee: r.fee, net: r.net, balanceAfter: r.balance_after,
        direction: outgoing ? 'out' : 'in',
        counterparty: cpName ? { name: cpName, phone: cpPhone } : null,
        description: r.description, currency: r.currency, createdAt: r.created_at,
      };
    }),
  });
});

walletRouter.get('/users/lookup', requireAuth(), async (req, res) => {
  const { phone } = parse(z.object({ phone: z.string() }), req.query);
  const { rows } = await pool.query(`SELECT full_name, role, business_name, status FROM users WHERE phone = $1`, [normalizePhone(phone)]);
  if (!rows[0] || rows[0].status !== 'active') throw notFound('Aucun compte actif avec ce numéro');
  res.json({ fullName: rows[0].full_name, role: rows[0].role, businessName: rows[0].business_name });
});

walletRouter.get('/codes/:code', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT full_name, role, business_name, public_code FROM users WHERE public_code = $1 AND status = 'active'`,
    [String(req.params.code).toUpperCase()],
  );
  if (!rows[0]) throw notFound('Code agent/marchand inconnu');
  res.json({ code: rows[0].public_code, role: rows[0].role, name: rows[0].business_name ?? rows[0].full_name });
});

walletRouter.get('/fees/quote', requireAuth(), async (req, res) => {
  const q = parse(z.object({ type: z.enum(['transfer', 'cash_out', 'merchant_payment']), amount }), req.query);
  res.json(pay.quote(q.type, q.amount));
});

walletRouter.post('/transfers', requireAuth('customer', 'merchant'), async (req, res) => {
  const b = parse(z.object({ toPhone: z.string(), amount, pin, note: z.string().max(140).optional() }), req.body);
  const r = await pay.transfer({ senderId: req.auth!.sub, ...b, idempotencyKey: idemKey(req) });
  res.status(r.replayed ? 200 : 201).json(r);
});

walletRouter.post('/cash-out', requireAuth('customer'), async (req, res) => {
  const b = parse(z.object({ agentCode: z.string(), amount, pin }), req.body);
  const r = await pay.cashOut({ customerId: req.auth!.sub, ...b, idempotencyKey: idemKey(req) });
  res.status(r.replayed ? 200 : 201).json(r);
});

walletRouter.post('/payments/merchant', requireAuth('customer'), async (req, res) => {
  const b = parse(z.object({ merchantCode: z.string(), amount, pin }), req.body);
  const r = await pay.payMerchant({ customerId: req.auth!.sub, ...b, idempotencyKey: idemKey(req) });
  res.status(r.replayed ? 200 : 201).json(r);
});

walletRouter.post('/agent/cash-in', requireAuth('agent'), async (req, res) => {
  const b = parse(z.object({ customerPhone: z.string(), amount, pin }), req.body);
  const r = await pay.cashIn({ agentId: req.auth!.sub, ...b, idempotencyKey: idemKey(req) });
  res.status(r.replayed ? 200 : 201).json(r);
});

walletRouter.post('/kyc', requireAuth(), async (req, res) => {
  const b = parse(
    z.object({
      docType: z.enum(['cni', 'passport', 'carte_consulaire', 'permis']),
      docNumber: z.string().trim().min(4).max(40),
    }),
    req.body,
  );
  const pending = await pool.query(`SELECT 1 FROM kyc_submissions WHERE user_id = $1 AND status = 'pending'`, [req.auth!.sub]);
  if (pending.rowCount) return res.status(409).json({ error: { code: 'KYC_PENDING', message: 'Une demande est déjà en cours de vérification' } });
  const { rows } = await pool.query(
    `INSERT INTO kyc_submissions (user_id, doc_type, doc_number) VALUES ($1,$2,$3) RETURNING id, status, created_at`,
    [req.auth!.sub, b.docType, b.docNumber],
  );
  res.status(201).json(rows[0]);
});
