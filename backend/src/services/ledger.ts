import { PoolClient } from 'pg';
import { Db } from '../db/pool';
import { config } from '../config';
import { AppError, badRequest } from '../lib/errors';
import { txReference } from '../lib/ids';

export type TxType =
  | 'transfer' | 'cash_in' | 'cash_out' | 'merchant_payment'
  | 'float_issuance' | 'float_redemption' | 'reversal';

export interface Entry {
  accountId: string;
  amount: number; // > 0 crédit, < 0 débit
}

export interface PostInput {
  type: TxType;
  amount: number;
  fee?: number;
  initiatorId: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  description?: string | null;
  idempotencyKey?: string | null;
  reversedTxId?: string | null;
  entries: Entry[];
}

export interface TransactionRow {
  id: string;
  reference: string;
  type: TxType;
  status: 'completed' | 'reversed';
  amount: number;
  fee: number;
  currency: string;
  initiator_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  description: string | null;
  reversed_tx_id: string | null;
  created_at: string;
}

export async function getSystemAccountId(db: Db, type: 'issuance' | 'fee_revenue'): Promise<string> {
  const { rows } = await db.query(
    `SELECT id FROM accounts WHERE type = $1 AND owner_id IS NULL AND currency = $2`,
    [type, config.currency],
  );
  if (rows[0]) return rows[0].id;
  const ins = await db.query(
    `INSERT INTO accounts (type, currency) VALUES ($1, $2)
     ON CONFLICT (type, currency) WHERE owner_id IS NULL DO UPDATE SET type = EXCLUDED.type
     RETURNING id`,
    [type, config.currency],
  );
  return ins.rows[0].id;
}

export async function createWallet(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO accounts (owner_id, type, currency) VALUES ($1, 'wallet', $2) RETURNING id`,
    [userId, config.currency],
  );
  return rows[0].id;
}

export async function getWalletId(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query(`SELECT id FROM accounts WHERE owner_id = $1 AND type = 'wallet'`, [userId]);
  if (!rows[0]) throw new AppError(500, 'NO_WALLET', 'Portefeuille introuvable');
  return rows[0].id;
}

export async function getBalance(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(`SELECT balance FROM accounts WHERE owner_id = $1 AND type = 'wallet'`, [userId]);
  return rows[0]?.balance ?? 0;
}

export async function findByIdempotencyKey(
  db: Db, initiatorId: string, key: string,
): Promise<TransactionRow | null> {
  const { rows } = await db.query(
    `SELECT * FROM transactions WHERE initiator_id = $1 AND idempotency_key = $2`,
    [initiatorId, key],
  );
  return rows[0] ?? null;
}

/**
 * Enregistre une transaction équilibrée dans le grand livre.
 * Doit être appelée à l'intérieur d'une transaction SQL (withTransaction).
 * Les comptes sont verrouillés dans un ordre déterministe pour éviter les interblocages.
 */
export async function post(client: PoolClient, input: PostInput): Promise<TransactionRow> {
  const entries = input.entries.filter((e) => e.amount !== 0);
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new AppError(500, 'UNBALANCED', 'Transaction non équilibrée');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw badRequest('INVALID_AMOUNT', 'Montant invalide');
  }

  const accountIds = [...new Set(entries.map((e) => e.accountId))].sort();
  const { rows: locked } = await client.query(
    `SELECT id, type, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [accountIds],
  );
  if (locked.length !== accountIds.length) throw new AppError(500, 'ACCOUNT_MISSING', 'Compte introuvable');

  const balances = new Map<string, { type: string; balance: number }>(
    locked.map((a) => [a.id, { type: a.type, balance: a.balance }]),
  );

  // Calcul des nouveaux soldes et contrôle de provision
  const after = new Map<string, number>();
  for (const e of entries) {
    const cur = after.get(e.accountId) ?? balances.get(e.accountId)!.balance;
    after.set(e.accountId, cur + e.amount);
  }
  for (const [id, bal] of after) {
    const t = balances.get(id)!.type;
    if ((t === 'wallet' || t === 'fee_revenue') && bal < 0) {
      throw badRequest('INSUFFICIENT_FUNDS', 'Solde insuffisant');
    }
  }

  const { rows: txRows } = await client.query(
    `INSERT INTO transactions
       (reference, type, amount, fee, currency, initiator_id, from_user_id, to_user_id, description, idempotency_key, reversed_tx_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      txReference(), input.type, input.amount, input.fee ?? 0, config.currency,
      input.initiatorId, input.fromUserId ?? null, input.toUserId ?? null,
      input.description ?? null, input.idempotencyKey ?? null, input.reversedTxId ?? null,
    ],
  );
  const tx: TransactionRow = txRows[0];

  const running = new Map<string, number>();
  for (const e of entries) {
    const cur = running.get(e.accountId) ?? balances.get(e.accountId)!.balance;
    const next = cur + e.amount;
    running.set(e.accountId, next);
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, amount, balance_after) VALUES ($1,$2,$3,$4)`,
      [tx.id, e.accountId, e.amount, next],
    );
  }
  for (const [id, bal] of after) {
    await client.query(`UPDATE accounts SET balance = $2 WHERE id = $1`, [id, bal]);
  }
  return tx;
}

/** Vérifie les invariants du grand livre (utilisé par l'admin et les tests). */
export async function checkLedger(db: Db) {
  const unbalanced = await db.query(
    `SELECT transaction_id, SUM(amount) AS s FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`,
  );
  const drift = await db.query(
    `SELECT a.id, a.balance, COALESCE(SUM(l.amount), 0) AS computed
       FROM accounts a LEFT JOIN ledger_entries l ON l.account_id = a.id
      GROUP BY a.id HAVING a.balance <> COALESCE(SUM(l.amount), 0)`,
  );
  const total = await db.query(`SELECT COALESCE(SUM(balance), 0)::bigint AS total FROM accounts`);
  const emoney = await db.query(
    `SELECT COALESCE(SUM(balance), 0)::bigint AS total FROM accounts WHERE type IN ('wallet','fee_revenue')`,
  );
  return {
    ok: unbalanced.rowCount === 0 && drift.rowCount === 0 && Number(total.rows[0].total) === 0,
    unbalancedTransactions: unbalanced.rows,
    balanceDrift: drift.rows,
    // monnaie électronique en circulation : doit être couverte à 100 % par le compte de cantonnement
    eMoneyInCirculation: Number(emoney.rows[0].total),
  };
}
