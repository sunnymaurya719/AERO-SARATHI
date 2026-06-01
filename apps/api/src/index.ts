import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './env.js';
import { logger } from './logger.js';
import { connectMongo, closeMongo } from './mongo.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler } from './middleware/error.js';
import { quotesRouter } from './modules/quotes/quotes.router.js';
import { authRouter } from './modules/auth/auth.router.js';
import { bookingsRouter } from './modules/bookings/bookings.router.js';
import { paymentsRouter } from './modules/payments/payments.router.js';
import { cancelRouter } from './modules/cancellations/cancel.router.js';
import { receiptsRouter } from './modules/receipts/receipts.router.js';
import { webhooksRouter } from './modules/webhooks/webhooks.router.js';
import { meRouter } from './modules/me/me.router.js';
import { adminRouter } from './modules/admin/admin.router.js';
import { driverRouter } from './modules/driver/driver.router.js';
import { startWebhookWorker } from './modules/webhooks/webhooks.worker.js';
import { startNotificationsWorker } from './modules/notifications/notifications.worker.js';
import { closeQueues } from './queues/index.js';
import { closePhase4Queues } from './queues/phase4.queues.js';
import { startPhase4Workers, closePhase4Workers } from './modules/assignment/workers/workers.js';
import { startPhase5Workers, closePhase5Workers } from './modules/trips/workers/workers.js';
import { closePhase5Queues } from './queues/phase5.queues.js';
import { trackingRouter } from './modules/tracking/tracking.router.js';
import { ensureRideLogIndexes } from './modules/tracking/ride-logs.store.js';
import { initRealtime, closeRealtime } from './realtime/io.js';
import { walletRouter } from './modules/wallet/wallet.router.js';
import { referralRouter } from './modules/referral/referral.router.js';
import { reviewRouter } from './modules/review/review.router.js';
import { notificationsFeedRouter } from './modules/notifications/notifications.feed.router.js';
import { eventsRouter } from './analytics/events.router.js';
import { startPhase6Workers, closePhase6Workers } from './workers/phase6.workers.js';
import { closePhase6Queues } from './queues/phase6.queues.js';
import { deviceTokensRouter } from './modules/device-tokens/device-tokens.router.js';
import { mobileRouter } from './modules/mobile/mobile-config.router.js';
import { chatRouter } from './modules/chat/chat.router.js';
import { callsRouter } from './modules/calls/calls.router.js';
import { ensureChatIndexes } from './modules/chat/chat.service.js';
import { ensureCallIndexes } from './modules/calls/call-mask.service.js';

const app: Express = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(cookieParser());

// Webhooks must receive the RAW body for signature verification — mount before
// the global JSON parser so express.json() never touches /webhooks.
app.use('/api/v1/webhooks', webhooksRouter);

app.use(express.json({ limit: '32kb' }));
app.use(requestId);
app.use(pinoHttp({ logger, customProps: (req) => ({ reqId: (req as { id?: string }).id }) }));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
});

app.use('/api/v1/quotes', quotesRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/bookings', paymentsRouter);
app.use('/api/v1/bookings', cancelRouter);
app.use('/api/v1/bookings', receiptsRouter);
app.use('/api/v1/me', meRouter);
if (env.WALLET_ENABLED) app.use('/api/v1/wallet', walletRouter);
if (env.REFERRAL_ENABLED) app.use('/api/v1/referrals', referralRouter);
if (env.REVIEWS_ENABLED) app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/notifications', notificationsFeedRouter);
if (env.ANALYTICS_ENABLED) app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/device-tokens', deviceTokensRouter);
app.use('/api/v1/mobile', mobileRouter);
if (env.CHAT_ENABLED) app.use('/api/v1/bookings', chatRouter);
if (env.CALLS_ENABLED) app.use('/api/v1/calls', callsRouter);

// Public live-tracking API — token-authorised, no session. Open to the public
// web origin so the shareable /track/[code] page can read it.
if (env.TRACKING_ENABLED) {
  app.use(
    '/api/v1/tracking',
    cors({
      origin: [...env.CORS_ORIGINS, ...env.DRIVER_CORS_ORIGINS],
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
    trackingRouter,
  );
}

// Admin API — gated by feature flag, with its own CORS origin allowlist so the
// admin SPA (separate origin/port) can send credentialed requests.
if (env.ADMIN_PANEL_ENABLED) {
  app.use(
    '/api/v1/admin',
    cors({
      origin: env.ADMIN_CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-csrf-token'],
    }),
    adminRouter,
  );
}

// Driver portal API — separate origin allowlist for the driver PWA.
if (env.DRIVER_PORTAL_ENABLED) {
  app.use(
    '/api/v1/driver',
    cors({
      origin: [...env.DRIVER_CORS_ORIGINS, ...env.CORS_ORIGINS],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
    driverRouter,
  );
}

app.use((_req, res) => {
  res.status(404).json({ type: 'about:blank', title: 'NotFound', status: 404, detail: 'Route not found' });
});

app.use(errorHandler);

async function start(): Promise<void> {
  await connectMongo();
  if (env.TRACKING_ENABLED) await ensureRideLogIndexes();
  if (env.CHAT_ENABLED) await ensureChatIndexes();
  if (env.CALLS_ENABLED) await ensureCallIndexes();
  const webhookWorker = startWebhookWorker();
  const notificationsWorker = startNotificationsWorker();
  if (env.ASSIGNMENT_AUTOMATION_ENABLED) startPhase4Workers();
  if (env.TRACKING_ENABLED) startPhase5Workers();
  startPhase6Workers();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on :${env.PORT} (${env.NODE_ENV})`);
  });
  if (env.DRIVER_PORTAL_ENABLED || env.TRACKING_ENABLED) initRealtime(server);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await Promise.allSettled([
      webhookWorker.close(),
      notificationsWorker.close(),
      closePhase4Workers(),
      closePhase5Workers(),
      closePhase6Workers(),
      closeRealtime(),
    ]);
    await closeQueues();
    await closePhase4Queues();
    await closePhase5Queues();
    await closePhase6Queues();
    await closeMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void start();

export { app };
