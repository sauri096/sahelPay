const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const KEY = 'sahelpay.admin.token';

export const getToken = () => sessionStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY));

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${API_URL}/v1${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) setToken(null);
  if (!res.ok) throw new Error(data?.error?.message ?? `Erreur ${res.status}`);
  return data;
}

export const fcfa = (n: number) => `${Math.round(Number(n)).toLocaleString('fr-FR')} F`;
export const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const TX_LABELS: Record<string, string> = {
  transfer: 'Transfert',
  cash_in: 'Dépôt',
  cash_out: 'Retrait',
  merchant_payment: 'Paiement marchand',
  float_issuance: 'Émission float',
  float_redemption: 'Rachat float',
  reversal: 'Annulation',
};

export const ROLE_LABELS: Record<string, string> = {
  customer: 'Client', agent: 'Agent', merchant: 'Marchand', admin: 'Admin',
};
