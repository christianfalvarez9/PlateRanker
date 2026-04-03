import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './auth/routes';
import { restaurantsRouter } from './restaurants/routes';
import { dishesRouter } from './dishes/routes';
import { reviewsRouter } from './reviews/routes';
import { visitsRouter } from './visits/routes';
import { usersRouter } from './users/routes';
import { startBackgroundJobs } from './jobs/repeatBadgeJob';

const app = express();
const corsOriginAllowlist = new Set(env.corsOriginAllowlist);

if (env.isProduction) {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOriginAllowlist.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.isProduction ? 'combined' : 'dev'));
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/restaurants', restaurantsRouter);
app.use('/dishes', dishesRouter);
app.use('/', reviewsRouter);
app.use('/visits', visitsRouter);
app.use('/users', usersRouter);

app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`PlateRank API running on port ${env.port} (${env.nodeEnv})`);
  startBackgroundJobs();
});

const shutdown = async () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
