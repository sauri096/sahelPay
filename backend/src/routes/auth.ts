import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { parse } from '../middleware';
import * as auth from '../services/auth';

export const authRouter = Router();

// Limite anti-brute-force sur les points d'entrée d'authentification
authRouter.use(
  rateLimit({ windowMs: 15 * 60_000, limit: config.nodeEnv === 'test' ? 10_000 : 50, standardHeaders: true, legacyHeaders: false }),
);

authRouter.post('/otp/request', async (req, res) => {
  const { phone } = parse(z.object({ phone: z.string() }), req.body);
  res.json(await auth.requestOtp(phone));
});

authRouter.post('/otp/verify', async (req, res) => {
  const b = parse(z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) }), req.body);
  res.json(await auth.verifyOtp(b.phone, b.code));
});

authRouter.post('/register', async (req, res) => {
  const b = parse(
    z.object({
      otpToken: z.string(),
      fullName: z.string().trim().min(2).max(80),
      pin: z.string(),
      accountType: z.enum(['customer', 'merchant']).default('customer'),
      businessName: z.string().trim().min(2).max(80).optional(),
    }),
    req.body,
  );
  res.status(201).json(await auth.register(b));
});

authRouter.post('/login', async (req, res) => {
  const b = parse(z.object({ phone: z.string(), pin: z.string() }), req.body);
  res.json(await auth.login(b.phone, b.pin));
});

authRouter.post('/pin/reset', async (req, res) => {
  const b = parse(z.object({ otpToken: z.string(), newPin: z.string() }), req.body);
  res.json(await auth.resetPin(b.otpToken, b.newPin));
});
