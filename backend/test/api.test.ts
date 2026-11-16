import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { migrate, pool } from '../src/db/pool';
import { createUser } from '../src/services/auth';
import { checkLedger } from '../src/services/ledger';

const app = createApp();
const PIN = '2580';

async function reset() {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
}

async function loginAs(phone: string, pin = PIN) {
  const r = await request(app).post('/v1/auth/login').send({ phone, pin });
  expect(r.status).toBe(200);
  return r.body.token as string;
}

async function signup(phone: string, fullName: string, extra: object = {}) {
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone });
  expect(otp.status).toBe(200);
  const v = await request(app).post('/v1/auth/otp/verify').send({ phone, code: otp.body.devCode });
  expect(v.status).toBe(200);
  const r = await request(app).post('/v1/auth/register').send({ otpToken: v.body.otpToken, fullName, pin: PIN, ...extra });
  expect(r.status).toBe(201);
  return r.body as { token: string; user: any };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function balanceOf(token: string) {
  const r = await request(app).get('/v1/me').set(auth(token));
  return r.body.wallet.balance as number;
}

let admin: string, agent: string, agentCode: string;

beforeAll(async () => {
  await reset();
});

beforeEach(async () => {
  await reset();
  await createUser({ phone: '+221700000001', fullName: 'Admin', pin: PIN, role: 'admin' });
  const a = await createUser({ phone: '+221700000002', fullName: 'Agent Diop', pin: PIN, role: 'agent', businessName: 'Boutique Diop' });
  agentCode = a.public_code;
  admin = await loginAs('+221700000001');
  agent = await loginAs('+221700000002');
  const f = await request(app).post('/v1/admin/float/issue').set(auth(admin)).send({ agentPhone: '+221700000002', amount: 1_000_000 });
  expect(f.status).toBe(201);
});

afterAll(async () => {
  await pool.end();
});

describe('Inscription et authentification', () => {
  it('inscrit un client via OTP et crée son portefeuille', async () => {
    const { token, user } = await signup('+221 77 111 22 33', 'Awa Sarr');
    expect(user.phone).toBe('+221771112233');
    expect(user.role).toBe('customer');
    expect(await balanceOf(token)).toBe(0);
  });

  it('refuse un OTP incorrect', async () => {
    await request(app).post('/v1/auth/otp/request').send({ phone: '+221771112233' });
    const v = await request(app).post('/v1/auth/otp/verify').send({ phone: '+221771112233', code: '000000' });
    expect(v.status).toBe(400);
    expect(v.body.error.code).toBe('OTP_INVALID');
  });

  it('refuse les PIN trop simples', async () => {
    const otp = await request(app).post('/v1/auth/otp/request').send({ phone: '+221771112233' });
    const v = await request(app).post('/v1/auth/otp/verify').send({ phone: '+221771112233', code: otp.body.devCode });
    const r = await request(app).post('/v1/auth/register').send({ otpToken: v.body.otpToken, fullName: 'Test', pin: '1234' });
    expect(r.body.error.code).toBe('WEAK_PIN');
  });

  it('bloque le compte après 5 PIN erronés puis le débloque par réinitialisation OTP', async () => {
    await signup('+221771112233', 'Awa');
    for (let i = 0; i < 4; i++) {
      const r = await request(app).post('/v1/auth/login').send({ phone: '+221771112233', pin: '9871' });
      expect(r.body.error.code).toBe('WRONG_PIN');
    }
    const locked = await request(app).post('/v1/auth/login').send({ phone: '+221771112233', pin: '9871' });
    expect(locked.body.error.code).toBe('ACCOUNT_BLOCKED');
    const ok = await request(app).post('/v1/auth/login').send({ phone: '+221771112233', pin: PIN });
    expect(ok.status).toBe(403);

    await pool.query(`DELETE FROM otp_codes`); // contourne l'anti-spam de 30 s
    const otp = await request(app).post('/v1/auth/otp/request').send({ phone: '+221771112233' });
    const v = await request(app).post('/v1/auth/otp/verify').send({ phone: '+221771112233', code: otp.body.devCode });
    const reset = await request(app).post('/v1/auth/pin/reset').send({ otpToken: v.body.otpToken, newPin: '3691' });
    expect(reset.status).toBe(200);
    await loginAs('+221771112233', '3691');
  });
});

describe('Flux d\'argent', () => {
  it('dépôt agent → transfert → paiement marchand → retrait, avec un grand livre équilibré', async () => {
    const awa = await signup('+221771111111', 'Awa Sarr');
    const ibra = await signup('+221772222222', 'Ibrahima Fall');
    const shop = await signup('+221773333333', 'Fatou', { accountType: 'merchant', businessName: 'Restaurant Teranga' });
    expect(shop.user.publicCode).toMatch(/^M-/);

    // Dépôt de 100 000 chez l'agent
    const ci = await request(app).post('/v1/agent/cash-in').set(auth(agent)).send({ customerPhone: '+221771111111', amount: 100_000, pin: PIN });
    expect(ci.status).toBe(201);
    expect(await balanceOf(awa.token)).toBe(100_000);
    expect(await balanceOf(agent)).toBe(900_000);

    // Transfert gratuit de 30 000
    const tr = await request(app).post('/v1/transfers').set(auth(awa.token)).send({ toPhone: '+221772222222', amount: 30_000, pin: PIN });
    expect(tr.status).toBe(201);
    expect(tr.body.transaction.fee).toBe(0);
    expect(await balanceOf(awa.token)).toBe(70_000);
    expect(await balanceOf(ibra.token)).toBe(30_000);

    // Paiement marchand de 10 000 : le client paie 10 000, le marchand reçoit 9 900
    const mp = await request(app).post('/v1/payments/merchant').set(auth(awa.token)).send({ merchantCode: shop.user.publicCode, amount: 10_000, pin: PIN });
    expect(mp.status).toBe(201);
    expect(await balanceOf(awa.token)).toBe(60_000);
    expect(await balanceOf(shop.token)).toBe(9_900);

    // Retrait de 20 000 : frais 1 % = 200, dont 40 % (80) pour l'agent
    const co = await request(app).post('/v1/cash-out').set(auth(ibra.token)).send({ agentCode, amount: 20_000, pin: PIN });
    expect(co.status).toBe(201);
    expect(co.body.transaction.fee).toBe(200);
    expect(await balanceOf(ibra.token)).toBe(9_800);
    expect(await balanceOf(agent)).toBe(900_000 + 20_080);

    const hist = await request(app).get('/v1/transactions').set(auth(awa.token));
    expect(hist.body.items.map((i: any) => i.type)).toEqual(['merchant_payment', 'transfer', 'cash_in']);
    expect(hist.body.items[0].counterparty.name).toBe('Restaurant Teranga');

    const ledger = await checkLedger(pool);
    expect(ledger.ok).toBe(true);
    expect(ledger.eMoneyInCirculation).toBe(1_000_000); // = float émis : la monnaie est intégralement couverte
  });

  it('refuse un transfert sans provision suffisante', async () => {
    const awa = await signup('+221771111111', 'Awa');
    await signup('+221772222222', 'Ibra');
    const r = await request(app).post('/v1/transfers').set(auth(awa.token)).send({ toPhone: '+221772222222', amount: 500, pin: PIN });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('refuse un transfert avec un mauvais PIN', async () => {
    const awa = await signup('+221771111111', 'Awa');
    const r = await request(app).post('/v1/transfers').set(auth(awa.token)).send({ toPhone: '+221700000002', amount: 500, pin: '9999' });
    expect(r.body.error.code).toBe('WRONG_PIN');
  });

  it('est idempotent : la même requête rejouée ne débite qu\'une fois', async () => {
    const awa = await signup('+221771111111', 'Awa');
    await signup('+221772222222', 'Ibra');
    await request(app).post('/v1/agent/cash-in').set(auth(agent)).send({ customerPhone: '+221771111111', amount: 10_000, pin: PIN });

    const send = () => request(app).post('/v1/transfers').set(auth(awa.token)).set('Idempotency-Key', 'abc-123')
      .send({ toPhone: '+221772222222', amount: 1_000, pin: PIN });
    const results = await Promise.all([send(), send(), send()]);
    const refs = new Set(results.map((r) => r.body.transaction.reference));
    expect(refs.size).toBe(1);
    expect(await balanceOf(awa.token)).toBe(9_000);
  });

  it('reste cohérent sous des retraits concurrents (pas de double dépense)', async () => {
    const awa = await signup('+221771111111', 'Awa');
    await signup('+221772222222', 'Ibra');
    await request(app).post('/v1/agent/cash-in').set(auth(agent)).send({ customerPhone: '+221771111111', amount: 5_000, pin: PIN });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/v1/transfers').set(auth(awa.token)).send({ toPhone: '+221772222222', amount: 1_000, pin: PIN })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await balanceOf(awa.token)).toBe(0);
    expect((await checkLedger(pool)).ok).toBe(true);
  });

  it('applique le plafond de solde KYC niveau 0 (200 000)', async () => {
    await signup('+221771111111', 'Awa');
    const r = await request(app).post('/v1/agent/cash-in').set(auth(agent)).send({ customerPhone: '+221771111111', amount: 250_000, pin: PIN });
    expect(r.body.error.code).toBe('BALANCE_LIMIT');
  });

  it('relève les plafonds après validation KYC par un admin', async () => {
    const awa = await signup('+221771111111', 'Awa');
    const k = await request(app).post('/v1/kyc').set(auth(awa.token)).send({ docType: 'cni', docNumber: '1234567890' });
    expect(k.status).toBe(201);
    const list = await request(app).get('/v1/admin/kyc').set(auth(admin));
    expect(list.body.items).toHaveLength(1);
    const rev = await request(app).post(`/v1/admin/kyc/${k.body.id}/review`).set(auth(admin)).send({ decision: 'approved' });
    expect(rev.status).toBe(200);
    const r = await request(app).post('/v1/agent/cash-in').set(auth(agent)).send({ customerPhone: '+221771111111', amount: 250_000, pin: PIN });
    expect(r.status).toBe(201);
  });

  it('permet à un admin d\'annuler une transaction', async () => {
    const awa = await signup('+221771111111', 'Awa');
    const ibra = await signup('+221772222222', 'Ibra');
    await request(app).post('/v1/agent/cash-in').set(auth(agent)).send({ customerPhone: '+221771111111', amount: 10_000, pin: PIN });
    const tr = await request(app).post('/v1/transfers').set(auth(awa.token)).send({ toPhone: '+221772222222', amount: 4_000, pin: PIN });
    const rv = await request(app).post(`/v1/admin/transactions/${tr.body.transaction.id}/reverse`).set(auth(admin)).send({ reason: 'Erreur de destinataire' });
    expect(rv.status).toBe(201);
    expect(await balanceOf(awa.token)).toBe(10_000);
    expect(await balanceOf(ibra.token)).toBe(0);
    const again = await request(app).post(`/v1/admin/transactions/${tr.body.transaction.id}/reverse`).set(auth(admin)).send({ reason: 'encore' });
    expect(again.body.error.code).toBe('ALREADY_REVERSED');
    expect((await checkLedger(pool)).ok).toBe(true);
  });

  it('interdit aux clients l\'accès admin et le dépôt agent', async () => {
    const awa = await signup('+221771111111', 'Awa');
    expect((await request(app).get('/v1/admin/stats').set(auth(awa.token))).status).toBe(403);
    expect((await request(app).post('/v1/agent/cash-in').set(auth(awa.token)).send({ customerPhone: '+221771111111', amount: 1, pin: PIN })).status).toBe(403);
  });

  it('un compte bloqué par un admin perd immédiatement l\'accès', async () => {
    const awa = await signup('+221771111111', 'Awa');
    await request(app).patch(`/v1/admin/users/${awa.user.id}`).set(auth(admin)).send({ status: 'blocked' });
    expect((await request(app).get('/v1/me').set(auth(awa.token))).status).toBe(403);
  });
});
