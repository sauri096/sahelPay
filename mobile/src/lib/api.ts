import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Sur un téléphone physique, utilisez l'IP de votre ordinateur (ex. http://192.168.1.10:4000)
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'sahelpay.token';
let memoryToken: string | null = null;

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') return memoryToken;
  memoryToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return memoryToken;
}

export async function saveToken(token: string | null) {
  memoryToken = token;
  if (Platform.OS === 'web') return;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Clé unique par tentative de paiement : protège contre les doubles débits en cas de réseau instable. */
export function newIdempotencyKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (memoryToken) headers.Authorization = `Bearer ${memoryToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Pas de connexion au serveur. Vérifiez votre réseau.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Une erreur est survenue');
  }
  return data as T;
}

// ---- Types partagés avec l'API ----
export type Role = 'customer' | 'agent' | 'merchant' | 'admin';

export interface User {
  id: string;
  phone: string;
  fullName: string;
  role: Role;
  kycLevel: number;
  publicCode: string | null;
  businessName: string | null;
}

export interface Me {
  user: User;
  wallet: { balance: number; currency: string };
  limits: { maxBalance: number; dailyOut: number; usedToday: number } | null;
  qr: string;
}

export interface HistoryItem {
  id: string;
  reference: string;
  type: 'transfer' | 'cash_in' | 'cash_out' | 'merchant_payment' | 'float_issuance' | 'float_redemption' | 'reversal';
  status: 'completed' | 'reversed';
  amount: number;
  fee: number;
  net: number;
  direction: 'in' | 'out';
  counterparty: { name: string; phone: string } | null;
  description: string | null;
  createdAt: string;
}

export interface Transaction {
  id: string;
  reference: string;
  type: string;
  amount: number;
  fee: number;
  created_at: string;
}
