import { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool';
import { config } from '../config';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { agentCommission, computeFee } from '../lib/fees';
import { normalizePhone } from '../lib/phone';
import { sms } from '../lib/sms';
import { verifyPin, Role } from './auth';
import {
  findByIdempotencyKey, getSystemAccountId, getWalletId, post, PostInput, TransactionRow,
} from './ledger';

interface UserRow {
  id: string; phone: string; full_name: string; role: Role; status: string;
  kyc_level: number; public_code: string | null; business_name: string | null;
}

const fmt = (n: number) => `${n.toLocaleString('fr-FR')} ${config.currency === 'XOF' || config.currency === 'XAF' ? 'FCFA' : config.currency}`;

async function userByPhone(db: PoolClient | typeof pool, phone: string): Promise<UserRow> {
  const { rows } = await db.query(`SELECT * FROM users WHERE phone = $1`, [normalizePhone(phone)]);
  if (!rows[0]) throw notFound('Aucun compte avec ce numéro');
  return rows[0];
}

async function userByCode(db: PoolClient | typeof pool, code: string, role: 'agent' | 'merchant'): Promise<UserRow> {
  const { rows } = await db.query(`SELECT * FROM users WHERE public_code = $1 AND role = $2`, [code.toUpperCase(), role]);
  if (!rows[0]) throw notFound(role === 'agent' ? 'Agent introuvable' : 'Marchand introuvable');
  return rows[0];
}

function assertActive(u: UserRow, who: string) {
  if (u.status !== 'active') throw new AppError(403, 'ACCOUNT_BLOCKED', `Le compte ${who} est bloqué`);
}

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw badRequest('INVALID_AMOUNT', 'Montant invalide');
  if (amount < 1) throw badRequest('AMOUNT_TOO_SMALL', 'Montant minimum : 1');
}

/** Plafonds réglementaires, appliqués aux comptes clients selon leur niveau KYC. */
async function assertDailyLimit(c: PoolClient, user: UserRow, outgoing: number) {
  if (user.role !== 'customer') return;
  const limit = config.limits[user.kyc_level];
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(amount + fee), 0)::bigint AS total FROM transactions
      WHERE from_user_id = $1 AND status = 'completed'
        AND type IN ('transfer', 'cash_out', 'merchant_payment')
        AND created_at >= date_trunc('day', now())`,
    [user.id],
  );
  if (Number(rows[0].total) + outgoing > limit.dailyOut) {
    throw badRequest('DAILY_LIMIT', `Plafond journalier atteint (${fmt(limit.dailyOut)}). Complétez votre KYC pour l'augmenter.`);
  }
}

async function assertMaxBalance(c: PoolClient, user: UserRow, incoming: number) {
  if (user.role !== 'customer') return;
  const limit = config.limits[user.kyc_level];
  const { rows } = await c.query(`SELECT balance FROM accounts WHERE owner_id = $1 AND type = 'wallet'`, [user.id]);
  if (rows[0].balance + incoming > limit.maxBalance) {
    throw badRequest('BALANCE_LIMIT', `Le solde du bénéficiaire dépasserait son plafond (${fmt(limit.maxBalance)})`);
  }
}

/**
 * Exécute une opération de manière idempotente : si la même clé a déjà été utilisée
 * par le même initiateur, on renvoie la transaction existante au lieu de débiter deux fois.
 */
async function idempotent(
  initiatorId: string, key: string | undefined,
  run: (c: PoolClient, key: string | null) => Promise<TransactionRow>,
): Promise<{ transaction: TransactionRow; replayed: boolean }> {
  if (key) {
    const existing = await findByIdempotencyKey(pool, initiatorId, key);
    if (existing) return { transaction: existing, replayed: true };
  }
  try {
    const transaction = await withTransaction((c) => run(c, key ?? null));
    return { transaction, replayed: false };
  } catch (err: any) {
    if (key && err?.code === '23505' && err?.constraint === 'transactions_idempotency') {
      const existing = await findByIdempotencyKey(pool, initiatorId, key);
      if (existing) return { transaction: existing, replayed: true };
    }
    throw err;
  }
}

function notify(phone: string, msg: string) {
  sms.send(phone, msg).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Transfert entre utilisateurs (P2P)
// ---------------------------------------------------------------------------
export async function transfer(p: {
  senderId: string; toPhone: string; amount: number; pin: string; note?: string; idempotencyKey?: string;
}) {
  assertAmount(p.amount);
  const sender = (await verifyPin(p.senderId, p.pin)) as UserRow;
  if (!['customer', 'merchant'].includes(sender.role)) throw forbidden('Ce type de compte ne peut pas faire de transfert');
  const receiver = await userByPhone(pool, p.toPhone);
  if (receiver.id === sender.id) throw badRequest('SELF_TRANSFER', 'Impossible de vous envoyer de l\'argent à vous-même');
  if (!['customer', 'merchant'].includes(receiver.role)) throw badRequest('INVALID_RECIPIENT', 'Ce numéro ne peut pas recevoir de transfert');
  assertActive(receiver, 'du bénéficiaire');

  const fee = computeFee('transfer', p.amount);
  const res = await idempotent(sender.id, p.idempotencyKey, async (c, key) => {
    await assertDailyLimit(c, sender, p.amount + fee);
    await assertMaxBalance(c, receiver, p.amount);
    const [from, to, rev] = [await getWalletId(c, sender.id), await getWalletId(c, receiver.id), await getSystemAccountId(c, 'fee_revenue')];
    return post(c, {
      type: 'transfer', amount: p.amount, fee, initiatorId: sender.id,
      fromUserId: sender.id, toUserId: receiver.id, description: p.note ?? null, idempotencyKey: key,
      entries: [
        { accountId: from, amount: -(p.amount + fee) },
        { accountId: to, amount: p.amount },
        { accountId: rev, amount: fee },
      ],
    });
  });
  if (!res.replayed) {
    notify(receiver.phone, `${config.appName} : vous avez reçu ${fmt(p.amount)} de ${sender.full_name}. Réf ${res.transaction.reference}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Dépôt (cash-in) : le client remet des espèces à l'agent, l'agent lui crédite de la monnaie électronique
// ---------------------------------------------------------------------------
export async function cashIn(p: { agentId: string; customerPhone: string; amount: number; pin: string; idempotencyKey?: string }) {
  assertAmount(p.amount);
  const agent = (await verifyPin(p.agentId, p.pin)) as UserRow;
  if (agent.role !== 'agent') throw forbidden('Réservé aux agents');
  const customer = await userByPhone(pool, p.customerPhone);
  if (customer.role !== 'customer') throw badRequest('INVALID_RECIPIENT', 'Le dépôt n\'est possible que sur un compte client');
  assertActive(customer, 'du client');

  const res = await idempotent(agent.id, p.idempotencyKey, async (c, key) => {
    await assertMaxBalance(c, customer, p.amount);
    const [from, to] = [await getWalletId(c, agent.id), await getWalletId(c, customer.id)];
    return post(c, {
      type: 'cash_in', amount: p.amount, initiatorId: agent.id,
      fromUserId: agent.id, toUserId: customer.id, idempotencyKey: key,
      entries: [{ accountId: from, amount: -p.amount }, { accountId: to, amount: p.amount }],
    });
  });
  if (!res.replayed) {
    notify(customer.phone, `${config.appName} : dépôt de ${fmt(p.amount)} chez ${agent.business_name ?? agent.full_name}. Réf ${res.transaction.reference}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Retrait (cash-out) : initié par le client (scan du QR de l'agent), l'agent remet les espèces
// ---------------------------------------------------------------------------
export async function cashOut(p: { customerId: string; agentCode: string; amount: number; pin: string; idempotencyKey?: string }) {
  assertAmount(p.amount);
  const customer = (await verifyPin(p.customerId, p.pin)) as UserRow;
  if (customer.role !== 'customer') throw forbidden('Réservé aux clients');
  const agent = await userByCode(pool, p.agentCode, 'agent');
  assertActive(agent, 'de l\'agent');

  const fee = computeFee('cash_out', p.amount);
  const commission = agentCommission(fee);
  const res = await idempotent(customer.id, p.idempotencyKey, async (c, key) => {
    await assertDailyLimit(c, customer, p.amount + fee);
    const [from, to, rev] = [await getWalletId(c, customer.id), await getWalletId(c, agent.id), await getSystemAccountId(c, 'fee_revenue')];
    return post(c, {
      type: 'cash_out', amount: p.amount, fee, initiatorId: customer.id,
      fromUserId: customer.id, toUserId: agent.id, idempotencyKey: key,
      entries: [
        { accountId: from, amount: -(p.amount + fee) },
        { accountId: to, amount: p.amount + commission },
        { accountId: rev, amount: fee - commission },
      ],
    });
  });
  if (!res.replayed) {
    notify(agent.phone, `${config.appName} : retrait de ${fmt(p.amount)} par ${customer.full_name}. Remettez les espèces. Réf ${res.transaction.reference}`);
  }
  return { ...res, commission };
}

// ---------------------------------------------------------------------------
// Paiement marchand (scan du QR du marchand) — les frais sont à la charge du marchand
// ---------------------------------------------------------------------------
export async function payMerchant(p: { customerId: string; merchantCode: string; amount: number; pin: string; idempotencyKey?: string }) {
  assertAmount(p.amount);
  const customer = (await verifyPin(p.customerId, p.pin)) as UserRow;
  if (customer.role !== 'customer') throw forbidden('Réservé aux clients');
  const merchant = await userByCode(pool, p.merchantCode, 'merchant');
  assertActive(merchant, 'du marchand');

  const fee = computeFee('merchant_payment', p.amount);
  const res = await idempotent(customer.id, p.idempotencyKey, async (c, key) => {
    await assertDailyLimit(c, customer, p.amount);
    const [from, to, rev] = [await getWalletId(c, customer.id), await getWalletId(c, merchant.id), await getSystemAccountId(c, 'fee_revenue')];
    return post(c, {
      type: 'merchant_payment', amount: p.amount, fee, initiatorId: customer.id,
      fromUserId: customer.id, toUserId: merchant.id, idempotencyKey: key,
      entries: [
        { accountId: from, amount: -p.amount },
        { accountId: to, amount: p.amount - fee },
        { accountId: rev, amount: fee },
      ],
    });
  });
  if (!res.replayed) {
    notify(merchant.phone, `${config.appName} : paiement de ${fmt(p.amount)} reçu de ${customer.full_name}. Réf ${res.transaction.reference}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Float agent (admin) : émission de monnaie électronique contre dépôt d'espèces à la banque
// ---------------------------------------------------------------------------
export async function issueFloat(p: { adminId: string; agentPhone: string; amount: number; idempotencyKey?: string }) {
  assertAmount(p.amount);
  const agent = await userByPhone(pool, p.agentPhone);
  if (agent.role !== 'agent') throw badRequest('NOT_AGENT', 'Ce numéro n\'est pas un agent');
  return idempotent(p.adminId, p.idempotencyKey, async (c, key) => {
    const [iss, to] = [await getSystemAccountId(c, 'issuance'), await getWalletId(c, agent.id)];
    const tx = await post(c, {
      type: 'float_issuance', amount: p.amount, initiatorId: p.adminId, toUserId: agent.id, idempotencyKey: key,
      description: 'Approvisionnement float agent',
      entries: [{ accountId: iss, amount: -p.amount }, { accountId: to, amount: p.amount }],
    });
    await audit(c, p.adminId, 'float.issue', agent.id, { amount: p.amount, tx: tx.reference });
    return tx;
  });
}

export async function redeemFloat(p: { adminId: string; agentPhone: string; amount: number; idempotencyKey?: string }) {
  assertAmount(p.amount);
  const agent = await userByPhone(pool, p.agentPhone);
  if (agent.role !== 'agent' && agent.role !== 'merchant') throw badRequest('NOT_AGENT', 'Seuls les agents et marchands peuvent être remboursés');
  return idempotent(p.adminId, p.idempotencyKey, async (c, key) => {
    const [iss, from] = [await getSystemAccountId(c, 'issuance'), await getWalletId(c, agent.id)];
    const tx = await post(c, {
      type: 'float_redemption', amount: p.amount, initiatorId: p.adminId, fromUserId: agent.id, idempotencyKey: key,
      description: 'Rachat de monnaie électronique (virement bancaire)',
      entries: [{ accountId: from, amount: -p.amount }, { accountId: iss, amount: p.amount }],
    });
    await audit(c, p.adminId, 'float.redeem', agent.id, { amount: p.amount, tx: tx.reference });
    return tx;
  });
}

// ---------------------------------------------------------------------------
// Annulation (admin) : contre-passation exacte des écritures d'origine
// ---------------------------------------------------------------------------
export async function reverse(p: { adminId: string; transactionId: string; reason: string }) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT * FROM transactions WHERE id = $1 FOR UPDATE`, [p.transactionId]);
    const orig: TransactionRow | undefined = rows[0];
    if (!orig) throw notFound('Transaction introuvable');
    if (orig.status === 'reversed') throw new AppError(409, 'ALREADY_REVERSED', 'Transaction déjà annulée');
    if (orig.type === 'reversal') throw badRequest('CANNOT_REVERSE', 'Impossible d\'annuler une annulation');

    const { rows: entries } = await c.query(
      `SELECT account_id, amount FROM ledger_entries WHERE transaction_id = $1`, [orig.id],
    );
    const input: PostInput = {
      type: 'reversal', amount: orig.amount, initiatorId: p.adminId,
      fromUserId: orig.to_user_id, toUserId: orig.from_user_id,
      description: `Annulation ${orig.reference} : ${p.reason}`, reversedTxId: orig.id,
      entries: entries.map((e) => ({ accountId: e.account_id, amount: -e.amount })),
    };
    const tx = await post(c, input);
    await c.query(`UPDATE transactions SET status = 'reversed' WHERE id = $1`, [orig.id]);
    await audit(c, p.adminId, 'transaction.reverse', orig.id, { reason: p.reason, reversal: tx.reference });
    return tx;
  });
}

export async function audit(c: PoolClient | typeof pool, actorId: string | null, action: string, target: string | null, details: object) {
  await c.query(`INSERT INTO audit_logs (actor_id, action, target, details) VALUES ($1,$2,$3,$4)`, [actorId, action, target, details]);
}

export function quote(kind: 'transfer' | 'cash_out' | 'merchant_payment', amount: number) {
  assertAmount(amount);
  const fee = computeFee(kind, amount);
  // Pour le paiement marchand, le client paie le montant exact ; les frais sont déduits côté marchand.
  const totalDebited = kind === 'merchant_payment' ? amount : amount + fee;
  return { amount, fee, totalDebited, currency: config.currency, feePaidBy: kind === 'merchant_payment' ? 'merchant' : 'sender' };
}
