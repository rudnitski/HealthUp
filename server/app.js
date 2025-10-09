const path = require('path');

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const express = require('express');
const fileUpload = require('express-fileupload');
const { healthcheck } = require('./db');
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

const { pool } = require('./db');

async function shutdown(code = 0) {
  try {
    await new Promise((resolve) => server.close(resolve));
    console.log('[http] Server closed');
  } catch (e) {
    console.error('[http] Error closing server:', e);
  }
  try {
    await pool.end();
    console.log('[db] Pool closed');
  } catch (e) {
    console.error('[db] Error closing pool:', e);
  } finally {
    process.exit(code);
  }
}

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => shutdown(0));
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
  shutdown(1);
});

process.on('unhandledRejection', (err) => {
  console.error('[fatal] Unhandled rejection:', err);
  shutdown(1);
});
