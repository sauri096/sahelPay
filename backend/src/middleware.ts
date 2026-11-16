import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodType } from 'zod';
import { AppError, forbidden, unauthorized } from './lib/errors';
import { AuthClaims, Role, verifyToken } from './services/auth';
import { pool } from './db/pool';
import { logger } from './lib/logger';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

export function requireAuth(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return next(unauthorized());
    let claims: AuthClaims;
    try {
      claims = verifyToken(h.slice(7));
    } catch {
      return next(unauthorized('Session expirée, reconnectez-vous'));
    }
    // On relit le statut et le rôle en base : un compte bloqué perd l'accès immédiatement.
    const { rows } = await pool.query(`SELECT role, status FROM users WHERE id = $1`, [claims.sub]);
    if (!rows[0]) return next(unauthorized());
    if (rows[0].status === 'blocked') return next(new AppError(403, 'ACCOUNT_BLOCKED', 'Compte bloqué'));
    claims.role = rows[0].role;
    if (roles.length && !roles.includes(claims.role)) return next(forbidden());
    req.auth = claims;
    next();
  };
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function idemKey(req: Request): string | undefined {
  const k = req.header('Idempotency-Key');
  if (!k) return undefined;
  if (k.length > 100) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key trop longue');
  return k;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Données invalides', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  if ((err as any)?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON invalide' } });
  }
  logger.error({ err }, 'Erreur non gérée');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Erreur interne, réessayez plus tard' } });
}
