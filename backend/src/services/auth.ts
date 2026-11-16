import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { pool, withTransaction } from '../db/pool';
import { config } from '../config';
import { AppError, badRequest, unauthorized } from '../lib/errors';
import { otpCode, publicCode } from '../lib/ids';
import { normalizePhone } from '../lib/phone';
import { sms } from '../lib/sms';
import { createWallet } from './ledger';

export type Role = 'customer' | 'agent' | 'merchant' | 'admin';

export interface AuthClaims {
  sub: string;
  role: Role;
  phone: string;
}

const hashOtp = (phone: string, code: string) =>
  createHash('sha256').update(`${config.jwtSecret}:${phone}:${code}`).digest('hex');

const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321']);

export function assertValidPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) throw badRequest('INVALID_PIN', 'Le code PIN doit contenir 4 chiffres');
  if (WEAK_PINS.has(pin)) throw badRequest('WEAK_PIN', 'Code PIN trop simple, choisissez-en un autre');
}

export async function requestOtp(rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const recent = await pool.query(
    `SELECT 1 FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '30 seconds'`,
    [phone],
  );
  if (recent.rowCount) throw new AppError(429, 'OTP_TOO_SOON', 'Patientez 30 secondes avant de redemander un code');

  const code = otpCode();
  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [phone, hashOtp(phone, code), config.otpTtlSeconds],
  );
  await sms.send(phone, `${config.appName} : votre code de vérification est ${code}. Ne le partagez avec personne.`);
  return { phone, expiresIn: config.otpTtlSeconds, ...(config.exposeOtp ? { devCode: code } : {}) };
}

export async function verifyOtp(rawPhone: string, code: string) {
  const phone = normalizePhone(rawPhone);
  const { rows } = await pool.query(
    `SELECT * FROM otp_codes WHERE phone = $1 AND consumed = false AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  const otp = rows[0];
  if (!otp) throw badRequest('OTP_EXPIRED', 'Code expiré, demandez-en un nouveau');
  if (otp.attempts >= 5) throw badRequest('OTP_LOCKED', 'Trop de tentatives, demandez un nouveau code');
  if (otp.code_hash !== hashOtp(phone, code)) {
    await pool.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    throw badRequest('OTP_INVALID', 'Code incorrect');
  }
  await pool.query(`UPDATE otp_codes SET consumed = true WHERE id = $1`, [otp.id]);

  const existing = await pool.query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  const otpToken = jwt.sign({ phone, purpose: 'otp' }, config.jwtSecret, { expiresIn: '10m' });
  return { otpToken, userExists: existing.rowCount! > 0 };
}

function readOtpToken(token: string): string {
  try {
    const p = jwt.verify(token, config.jwtSecret) as { phone: string; purpose: string };
    if (p.purpose !== 'otp') throw new Error();
    return p.phone;
  } catch {
    throw unauthorized('Vérification du numéro expirée, recommencez');
  }
}

export function signToken(user: { id: string; role: Role; phone: string }) {
  return jwt.sign({ sub: user.id, role: user.role, phone: user.phone } satisfies AuthClaims, config.jwtSecret, {
    expiresIn: config.jwtTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): AuthClaims {
  const p = jwt.verify(token, config.jwtSecret) as AuthClaims & { purpose?: string };
  if (p.purpose) throw new Error('mauvais type de jeton');
  return p;
}

export async function createUser(input: {
  phone: string; fullName: string; pin: string; role: Role; businessName?: string | null;
}) {
  assertValidPin(input.pin);
  const phone = normalizePhone(input.phone);
  const pinHash = await bcrypt.hash(input.pin, 10);
  const code = input.role === 'agent' ? publicCode('A') : input.role === 'merchant' ? publicCode('M') : null;
  return withTransaction(async (c) => {
    const exists = await c.query(`SELECT 1 FROM users WHERE phone = $1`, [phone]);
    if (exists.rowCount) throw new AppError(409, 'PHONE_TAKEN', 'Ce numéro a déjà un compte');
    const { rows } = await c.query(
      `INSERT INTO users (phone, full_name, role, pin_hash, public_code, business_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [phone, input.fullName.trim(), input.role, pinHash, code, input.businessName ?? null],
    );
    await createWallet(c, rows[0].id);
    return rows[0];
  });
}

export async function register(input: {
  otpToken: string; fullName: string; pin: string; accountType: 'customer' | 'merchant'; businessName?: string;
}) {
  const phone = readOtpToken(input.otpToken);
  if (input.accountType === 'merchant' && !input.businessName) {
    throw badRequest('BUSINESS_NAME_REQUIRED', 'Le nom du commerce est obligatoire');
  }
  const user = await createUser({
    phone, fullName: input.fullName, pin: input.pin, role: input.accountType, businessName: input.businessName,
  });
  return { token: signToken(user), user: publicUser(user) };
}

/** Vérifie le PIN, gère le compteur d'échecs et le blocage. À appeler HORS transaction de paiement. */
export async function verifyPin(userId: string, pin: string) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  const user = rows[0];
  if (!user) throw unauthorized();
  if (user.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED', 'Compte bloqué, contactez le service client');
  const ok = await bcrypt.compare(pin, user.pin_hash);
  if (!ok) {
    const { rows: upd } = await pool.query(
      `UPDATE users SET failed_pin_attempts = failed_pin_attempts + 1,
         status = CASE WHEN failed_pin_attempts + 1 >= $2 THEN 'blocked'::user_status ELSE status END
       WHERE id = $1 RETURNING failed_pin_attempts, status`,
      [userId, config.maxPinAttempts],
    );
    if (upd[0].status === 'blocked') {
      throw new AppError(403, 'ACCOUNT_BLOCKED', 'Trop d\'erreurs de PIN : compte bloqué. Réinitialisez votre PIN par SMS.');
    }
    const left = config.maxPinAttempts - upd[0].failed_pin_attempts;
    throw new AppError(401, 'WRONG_PIN', `Code PIN incorrect (${left} essai(s) restant(s))`);
  }
  if (user.failed_pin_attempts > 0) {
    await pool.query(`UPDATE users SET failed_pin_attempts = 0 WHERE id = $1`, [userId]);
  }
  return user;
}

export async function login(rawPhone: string, pin: string) {
  const phone = normalizePhone(rawPhone);
  const { rows } = await pool.query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (!rows[0]) throw new AppError(401, 'WRONG_CREDENTIALS', 'Numéro ou code PIN incorrect');
  const user = await verifyPin(rows[0].id, pin);
  return { token: signToken(user), user: publicUser(user) };
}

/** PIN oublié : la possession du numéro (OTP) permet de redéfinir le PIN et débloque le compte. */
export async function resetPin(otpToken: string, newPin: string) {
  const phone = readOtpToken(otpToken);
  assertValidPin(newPin);
  const hash = await bcrypt.hash(newPin, 10);
  const { rows } = await pool.query(
    `UPDATE users SET pin_hash = $2, failed_pin_attempts = 0,
       status = CASE WHEN status = 'blocked' AND failed_pin_attempts >= $3 THEN 'active'::user_status ELSE status END
     WHERE phone = $1 RETURNING *`,
    [phone, hash, config.maxPinAttempts],
  );
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Aucun compte pour ce numéro');
  return { token: signToken(rows[0]), user: publicUser(rows[0]) };
}

export function publicUser(u: any) {
  return {
    id: u.id,
    phone: u.phone,
    fullName: u.full_name,
    role: u.role as Role,
    status: u.status,
    kycLevel: u.kyc_level,
    publicCode: u.public_code,
    businessName: u.business_name,
    createdAt: u.created_at,
  };
}
