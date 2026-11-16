import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { authRouter } from './routes/auth';
import { walletRouter } from './routes/wallet';
import { adminRouter } from './routes/admin';
import { errorHandler } from './middleware';
import { logger } from './lib/logger';
import { config } from './config';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(express.json({ limit: '50kb' }));
  if (config.nodeEnv !== 'test') app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, app: config.appName, currency: config.currency });
  });
  app.use('/v1/auth', authRouter);
  app.use('/v1/admin', adminRouter);
  app.use('/v1', walletRouter);
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route inconnue' } });
  });
  app.use(errorHandler);
  return app;
}
