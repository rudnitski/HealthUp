// ESM imports must come first
import path from 'path';
import { getDirname } from './utils/path-helpers.js';
import express from 'express';
import fileUpload from 'express-fileupload';
import { healthcheck, pool } from './db/index.js';
import { ensureSchema } from './db/schema.js';
import VisionProviderFactory from './services/vision/VisionProviderFactory.js';
import sqlGeneratorRouter from './routes/sqlGenerator.js';
import chatStreamRouter from './routes/chatStream.js';
import analyzeLabReportRouter from './routes/analyzeLabReport.js';
import reportsRouter from './routes/reports.js';
import executeSqlRouter from './routes/executeSql.js';
import adminRouter from './routes/admin.js';
import gmailDevRouter from './routes/gmailDev.js';
import { shutdownSchemaSnapshot } from './services/schemaSnapshot.js';
import sessionManager from './utils/sessionManager.js';

const __dirname = getDirname(import.meta.url);

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  try {
    await import('dotenv/config');
  } catch (_) {}
}

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
  } catch (e) {
    console.error('[db] Healthcheck failed on boot:', e);
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
app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.static(publicDir));

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

const server = app.listen(PORT, () => {
  console.log(`HealthUp upload form available at http://localhost:${PORT}`);
});

let isShuttingDown = false;

async function shutdown(code = 0, { skipPool = false } = {}) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    if (server?.listening) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            console.error('[http] Error closing server:', err);
          } else {
            console.log('[http] Server closed');
          }
          resolve();
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
