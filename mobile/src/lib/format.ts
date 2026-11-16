import { HistoryItem } from './api';

export function money(n: number, currency = 'XOF') {
  const unit = currency === 'XOF' || currency === 'XAF' ? 'F' : currency;
  return `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} ${unit}`;
}

export function dateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function txLabel(t: HistoryItem) {
  const who = t.counterparty?.name ?? '';
  switch (t.type) {
    case 'transfer': return t.direction === 'out' ? `À ${who}` : `De ${who}`;
    case 'cash_in': return t.direction === 'in' ? 'Dépôt' : `Dépôt pour ${who}`;
    case 'cash_out': return t.direction === 'out' ? 'Retrait' : `Retrait de ${who}`;
    case 'merchant_payment': return t.direction === 'out' ? `Paiement ${who}` : `Paiement de ${who}`;
    case 'float_issuance': return 'Approvisionnement float';
    case 'float_redemption': return 'Rachat float';
    case 'reversal': return 'Annulation';
  }
}

/** Format des QR codes SahelPay : SAHELPAY:<U|A|M>:<numéro ou code> */
export type QrTarget =
  | { kind: 'user'; phone: string }
  | { kind: 'agent'; code: string }
  | { kind: 'merchant'; code: string };

export function parseQr(data: string): QrTarget | null {
  const m = /^SAHELPAY:([UAM]):(.+)$/.exec(data.trim());
  if (!m) return null;
  if (m[1] === 'U') return { kind: 'user', phone: m[2] };
  if (m[1] === 'A') return { kind: 'agent', code: m[2] };
  return { kind: 'merchant', code: m[2] };
}
