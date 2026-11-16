import { config } from '../config';

export type FeeKind = 'transfer' | 'cash_out' | 'merchant_payment' | 'cash_in';

/** Frais arrondis à l'unité supérieure (on ne facture jamais de fraction de franc). */
export function computeFee(kind: FeeKind, amount: number): number {
  const bps =
    kind === 'transfer' ? config.fees.transferBps
    : kind === 'cash_out' ? config.fees.cashOutBps
    : kind === 'merchant_payment' ? config.fees.merchantBps
    : 0;
  if (bps === 0) return 0;
  return Math.ceil((amount * bps) / 10_000);
}

/** Part des frais de retrait reversée à l'agent (arrondie à l'inférieur). */
export function agentCommission(fee: number): number {
  return Math.floor((fee * config.fees.agentCommissionShareBps) / 10_000);
}
