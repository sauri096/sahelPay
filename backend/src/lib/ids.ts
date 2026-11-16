import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I pour éviter la confusion

function randomString(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function txReference(): string {
  return 'TX' + randomString(10);
}

export function publicCode(prefix: 'A' | 'M'): string {
  return `${prefix}-${randomString(6)}`;
}

export function otpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
