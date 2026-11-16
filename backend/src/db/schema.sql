-- SahelPay : schéma PostgreSQL
-- Tous les montants sont des entiers en unité de base (1 = 1 FCFA, pas de centimes).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer', 'agent', 'merchant', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM (
    'wallet',          -- portefeuille d'un utilisateur (client, agent, marchand)
    'issuance',        -- contrepartie de la monnaie émise (adossée au compte de cantonnement)
    'fee_revenue'      -- revenus de frais de la plateforme
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tx_type AS ENUM (
    'transfer', 'cash_in', 'cash_out', 'merchant_payment', 'float_issuance', 'float_redemption', 'reversal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tx_status AS ENUM ('completed', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'customer',
  status          user_status NOT NULL DEFAULT 'active',
  pin_hash        TEXT NOT NULL,
  failed_pin_attempts INT NOT NULL DEFAULT 0,
  kyc_level       INT NOT NULL DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 2),
  -- code public pour les agents (A-xxxxxx) et les marchands (M-xxxxxx)
  public_code     TEXT UNIQUE,
  business_name   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  consumed    BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES users(id),
  type        account_type NOT NULL,
  currency    TEXT NOT NULL,
  balance     BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- un portefeuille ne peut jamais être négatif ; le compte d'émission l'est par construction
  CONSTRAINT wallet_non_negative CHECK (type <> 'wallet' OR balance >= 0),
  CONSTRAINT fee_non_negative CHECK (type <> 'fee_revenue' OR balance >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_wallet_per_user ON accounts (owner_id) WHERE type = 'wallet';
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_system_per_type ON accounts (type, currency) WHERE owner_id IS NULL;

CREATE TABLE IF NOT EXISTS transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE,
  type             tx_type NOT NULL,
  status           tx_status NOT NULL DEFAULT 'completed',
  amount           BIGINT NOT NULL CHECK (amount > 0),
  fee              BIGINT NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency         TEXT NOT NULL,
  initiator_id     UUID REFERENCES users(id),
  from_user_id     UUID REFERENCES users(id),
  to_user_id       UUID REFERENCES users(id),
  description      TEXT,
  idempotency_key  TEXT,
  reversed_tx_id   UUID REFERENCES transactions(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency ON transactions (initiator_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_from_idx ON transactions (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_to_idx ON transactions (to_user_id, created_at DESC);

-- Grand livre en partie double : pour chaque transaction, la somme des écritures vaut 0.
-- amount > 0 = crédit du compte, amount < 0 = débit du compte.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              BIGSERIAL PRIMARY KEY,
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  amount          BIGINT NOT NULL CHECK (amount <> 0),
  balance_after   BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (account_id, id);
CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries (transaction_id);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  doc_type     TEXT NOT NULL,
  doc_number   TEXT NOT NULL,
  status       kyc_status NOT NULL DEFAULT 'pending',
  reviewer_id  UUID REFERENCES users(id),
  review_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kyc_status_idx ON kyc_submissions (status, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  target      TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
