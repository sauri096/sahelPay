import 'dotenv/config';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : Number(v);
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET doit être défini en production');
}

export const config = {
  nodeEnv,
  port: num('PORT', 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/wallet',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtTtl: process.env.JWT_TTL ?? '12h',
  currency: process.env.CURRENCY ?? 'XOF',
  appName: process.env.APP_NAME ?? 'SahelPay',
  // En développement, le code OTP est renvoyé dans la réponse pour faciliter les tests.
  exposeOtp: process.env.EXPOSE_OTP ? process.env.EXPOSE_OTP === 'true' : nodeEnv !== 'production',
  otpTtlSeconds: num('OTP_TTL_SECONDS', 300),
  maxPinAttempts: num('MAX_PIN_ATTEMPTS', 5),

  // Frais en points de base (100 = 1 %)
  fees: {
    transferBps: num('FEE_TRANSFER_BPS', 0),          // transferts gratuits (modèle Wave)
    cashOutBps: num('FEE_CASH_OUT_BPS', 100),          // 1 % au retrait
    merchantBps: num('FEE_MERCHANT_BPS', 100),         // 1 % payé par le marchand
    agentCommissionShareBps: num('AGENT_COMMISSION_SHARE_BPS', 4000), // 40 % des frais de retrait reversés à l'agent
  },

  // Plafonds par niveau KYC : [solde max, cumul sortant journalier max]
  limits: {
    0: { maxBalance: num('LIMIT_L0_BALANCE', 200_000), dailyOut: num('LIMIT_L0_DAILY', 100_000) },
    1: { maxBalance: num('LIMIT_L1_BALANCE', 2_000_000), dailyOut: num('LIMIT_L1_DAILY', 1_000_000) },
    2: { maxBalance: num('LIMIT_L2_BALANCE', 10_000_000), dailyOut: num('LIMIT_L2_DAILY', 5_000_000) },
  } as Record<number, { maxBalance: number; dailyOut: number }>,
};
