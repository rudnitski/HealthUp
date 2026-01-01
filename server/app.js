// Load environment variables before other imports so downstream modules see them
import './config/loadEnv.js';

import path from 'path';
import { getDirname } from './utils/path-helpers.js';
import express from 'express';
import fileUpload from 'express-fileupload';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { healthcheck, pool, adminPool, validateAdminPool } from './db/index.js';
import { ensureSchema } from './db/schema.js';
import { startSessionCleanup, stopSessionCleanup } from './jobs/sessionCleanup.js';
import authRouter from './routes/auth.js';
import VisionProviderFactory from './services/vision/VisionProviderFactory.js';
import sqlGeneratorRouter from './routes/sqlGenerator.js';
import chatStreamRouter, { closeSSEConnection } from './routes/chatStream.js';
import analyzeLabReportRouter from './routes/analyzeLabReport.js';
import reportsRouter from './routes/reports.js';
import executeSqlRouter from './routes/executeSql.js';
import adminRouter from './routes/admin.js';
import gmailDevRouter from './routes/gmailDev.js';
import { shutdownSchemaSnapshot } from './services/schemaSnapshot.js';
import sessionManager from './utils/sessionManager.js';
import { shutdown as shutdownJobManager } from './utils/jobManager.js';

// PRD v4.3: Wire SSE cleanup hook to sessionManager
// This ensures SSE connections are closed when their sessions expire
sessionManager.onSessionExpired = closeSSEConnection;
sessionManager.startCleanup();

const __dirname = getDirname(import.meta.url);

// Increase max listeners for process event emitter
// Multiple modules legitimately register exit/signal handlers for cleanup:
// - db pool error handler
// - SIGINT/SIGTERM handlers (app.js)
// - uncaughtException/unhandledRejection handlers (app.js)
// - various cleanup routines in loaded modules
process.setMaxListeners(20);

// Database initialization
(async () => {
  try {
    await ensureSchema();
    const ok = await healthcheck();
    if (!ok) throw new Error('DB healthcheck failed');
    console.log('[db] Healthcheck OK');

    // PRD v4.4.2: Validate adminPool has BYPASSRLS privilege
    await validateAdminPool();

    // PRD v4.4.2: Start session cleanup job (runs on startup + hourly)
    startSessionCleanup();
  } catch (e) {
    console.error('[db] Initialization failed on boot:', e);
    process.exit(1);
  }
})();

// Validate OCR provider configuration on startup (non-fatal warning)
try {
  const ocrProvider = process.env.OCR_PROVIDER || 'openai';
  const fallbackEnabled = process.env.VISION_FALLBACK_ENABLED === 'true';

  console.log(`[Startup] Validating OCR provider: ${ocrProvider} (fallback: ${fallbackEnabled ? 'enabled' : 'disabled'})`);

  const provider = VisionProviderFactory.createWithFallback();
  provider.validateConfig();

  console.log(`[Startup] ✅ OCR provider validated: ${ocrProvider}`);
} catch (error) {
  console.warn(`[Startup] ⚠️  OCR provider validation failed: ${error.message}`);
  console.warn('[Startup] Lab report upload will not work until OCR is configured.');
  console.warn('[Startup] Check your .env configuration:');
  console.warn(`  - OCR_PROVIDER=${process.env.OCR_PROVIDER || 'openai'}`);
  console.warn(`  - OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? '✅ set' : '❌ missing'}`);
  console.warn(`  - ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? '✅ set' : '❌ missing'}`);
  console.warn('[Startup] Other features (SQL generation, admin) will continue to work.');
  // Don't exit - let the app start, OCR validation will fail at request time if keys are missing
}

const app = express();

// PRD v4.4.2: Trust proxy for accurate client IPs (required behind Cloudflare, nginx, etc.)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// PRD v4.4.2: Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for now (configure in Part 4)
  crossOriginEmbedderPolicy: false, // Allow external resources (Google Sign-In SDK)
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } // Allow Google OAuth popup to message opener
}));

// PRD v4.4.2: Cookie parsing - REQUIRED for req.cookies to be populated
// Must be applied BEFORE auth routes
app.use(cookieParser());

app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.static(publicDir));

// Track open sockets to force-close long-lived connections (e.g., SSE) on shutdown
const activeConnections = new Set();
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = Number.isFinite(Number(process.env.SHUTDOWN_TIMEOUT_MS))
  ? Number(process.env.SHUTDOWN_TIMEOUT_MS)
  : 5000;
let server;

// Only apply file upload middleware to upload routes (avoid warnings on JSON/SSE routes)
const uploadMiddleware = fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 },
  abortOnLimit: false,
  useTempFiles: false,
  preserveExtension: true,
  safeFileNames: true,
  debug: true,
});

const uploadGuard = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  return uploadMiddleware(req, res, next);
};

// File upload error handler
app.use((err, req, res, next) => {
  if (err) {
    console.error('[fileUpload] Middleware error:', {
      error: err.message,
      code: err.code,
      path: req.path
    });
  }
  next(err);
});

// File upload + request logging for analyze-labs (only runs for multipart/form-data)
app.use('/api/analyze-labs', uploadGuard);

app.use('/api/analyze-labs', (req, res, next) => {
  const reqId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

  console.log(`[http:${reqId}] /api/analyze-labs request:`, {
    method: req.method,
    content_type: req.headers['content-type'],
    content_length: req.headers['content-length'],
    has_files: !!req.files,
    files_count: req.files ? Object.keys(req.files).length : 0
  });

  // Track response completion
  res.on('finish', () => {
    console.log(`[http:${reqId}] Response finished:`, {
      status_code: res.statusCode,
      headers_sent: res.headersSent
    });
  });

  res.on('close', () => {
    console.log(`[http:${reqId}] Response closed:`, {
      finished: res.writableFinished,
      headers_sent: res.headersSent
    });
  });

  res.on('error', (err) => {
    console.error(`[http:${reqId}] Response error:`, {
      error: err.message,
      stack: err.stack
    });
  });

  next();
});

// PRD v4.4.2: Auth routes (must be before other protected routes)
app.use('/api/auth', authRouter);

app.use('/api/sql-generator', sqlGeneratorRouter);
app.use('/api/chat', chatStreamRouter); // v3.2: Conversational SQL assistant
app.use('/api/analyze-labs', analyzeLabReportRouter);
app.use('/api/execute-sql', executeSqlRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dev-gmail', gmailDevRouter);
app.use('/api', reportsRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin/pending-analytes', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/health/db', async (_req, res) => {
  try {
    const ok = await healthcheck();
    res.json({ db: ok ? 'up' : 'down' });
  } catch (e) {
    res.status(500).json({ db: 'down', error: String(e?.message || e) });
  }
});

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// centralized error handler
app.use((err, req, res, _next) => {
  console.error('[http] Error caught by middleware:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    error_code: err.code,
    error_status: err.statusCode || err.status
  });

  const statusCode = err.statusCode || err.status || 500;
  const errorMessage = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: errorMessage,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

server = app.listen(PORT, () => {
  console.log(`HealthUp upload form available at http://localhost:${PORT}`);
});

server.on('connection', (socket) => {
  activeConnections.add(socket);
  socket.on('close', () => activeConnections.delete(socket));
});

let isShuttingDown = false;

async function shutdown(code = 0, { skipPool = false } = {}) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    if (server?.listening) {
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const forceCloseTimer = setTimeout(() => {
          console.warn(`[http] Force closing ${activeConnections.size} open connection(s) after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms`);
          for (const socket of activeConnections) {
            try {
              socket.destroy();
            } catch (err) {
              console.error('[http] Error destroying socket during shutdown:', err);
            }
          }
          done();
        }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

        server.close((err) => {
          clearTimeout(forceCloseTimer);
          if (err) {
            console.error('[http] Error closing server:', err);
          } else {
            console.log('[http] Server closed');
          }
          done();
        });
      });
    }
  } catch (e) {
    console.error('[http] Error closing server:', e);
  }

  if (!skipPool) {
    try {
      sessionManager.shutdown();
    } catch (e) {
      console.error('[sessionManager] Shutdown error:', e);
    }

    try {
      shutdownJobManager();
    } catch (e) {
      console.error('[jobManager] Shutdown error:', e);
    }

    // PRD v4.4.2: Stop session cleanup job
    try {
      stopSessionCleanup();
    } catch (e) {
      console.error('[sessionCleanup] Shutdown error:', e);
    }

    try {
      await shutdownSchemaSnapshot();
    } catch (e) {
      console.error('[schemaSnapshot] Shutdown error:', e);
    }

    try {
      if (pool.ending || pool.ended) {
        console.log('[db] Pool already closing');
      } else {
        await pool.end();
        console.log('[db] Pool closed');
      }
    } catch (e) {
      if (String(e?.message || e).includes('Called end on pool more than once')) {
        console.log('[db] Pool already closed');
      } else {
        console.error('[db] Error closing pool:', e);
      }
    }

    // PRD v4.4.2: Close admin pool
    try {
      if (adminPool.ending || adminPool.ended) {
        console.log('[db:admin] Pool already closing');
      } else {
        await adminPool.end();
        console.log('[db:admin] Pool closed');
      }
    } catch (e) {
      if (String(e?.message || e).includes('Called end on pool more than once')) {
        console.log('[db:admin] Pool already closed');
      } else {
        console.error('[db:admin] Error closing pool:', e);
      }
    }
  }

  process.exit(code);
}

server.on('error', (err) => {
  console.error('[http] Server error:', err);
  if (err?.code === 'EADDRINUSE') {
    console.error(`[http] Port ${PORT} is already in use. Is another instance running?`);
    shutdown(1, { skipPool: true });
  } else {
    shutdown(1);
  }
});

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => shutdown(0));
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
  shutdown(1, { skipPool: true });
});

process.on('unhandledRejection', (err) => {
  console.error('[fatal] Unhandled rejection:', err);
  shutdown(1, { skipPool: true });
});
