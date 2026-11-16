import { badRequest } from './errors';

/**
 * Normalise un numéro au format E.164 (+221771234567).
 * Accepte "+221 77 123 45 67", "0022177...", etc.
 */
export function normalizePhone(input: string): string {
  let p = input.replace(/[\s.\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (!/^\+\d{8,15}$/.test(p)) {
    throw badRequest('INVALID_PHONE', 'Numéro de téléphone invalide (format international attendu, ex. +221771234567)');
  }
  return p;
}
