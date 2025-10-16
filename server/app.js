const path = require('path');

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const express = require('express');
const fileUpload = require('express-fileupload');
const { healthcheck, pool } = require('./db');
const { ensureSchema } = require('./db/schema');

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

const sqlGeneratorRouter = require('./routes/sqlGenerator');
const analyzeLabReportRouter = require('./routes/analyzeLabReport');
const reportsRouter = require('./routes/reports');
const executeSqlRouter = require('./routes/executeSql');
const { shutdownSchemaSnapshot } = require('./services/schemaSnapshot');

const app = express();
app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.static(publicDir));

app.use(
  fileUpload({
    limits: { fileSize: 10 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: false,
    preserveExtension: true,
    safeFileNames: true,
  }),
);

app.use('/api/sql-generator', sqlGeneratorRouter);
app.use('/api/analyze-labs', analyzeLabReportRouter);
app.use('/api/execute-sql', executeSqlRouter);
app.use('/api', reportsRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
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
app.use((err, _req, res, _next) => {
  console.error('[http] Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
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
