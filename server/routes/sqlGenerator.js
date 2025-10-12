const express = require('express');
const { handleGeneration, SqlGeneratorError } = require('../services/sqlGenerator');
const { bustCache, reloadSchemaAliases } = require('../services/schemaSnapshot');
const { reloadSchemaAliases: reloadPromptAliases } = require('../services/promptBuilder');

const router = express.Router();

const getUserIdentifier = (req) => {
  if (req?.user?.id) {
    return req.user.id;
  }

  if (typeof req?.headers?.['x-user-id'] === 'string' && req.headers['x-user-id'].trim()) {
    return req.headers['x-user-id'].trim();
  }

  if (typeof req?.ip === 'string' && req.ip) {
    return req.ip;
  }

  return 'anonymous';
};

// POST /api/sql-generator - Generate SQL
router.post('/', async (req, res) => {
  const question = req?.body?.question;
  const model = req?.body?.model; // Optional model override

  try {
    const result = await handleGeneration({
      question,
      userIdentifier: getUserIdentifier(req),
      model,
    });

    // Handle validation failure (ok: false)
    if (result.ok === false) {
      return res.status(422).json(result);
    }

    return res.json(result);
  } catch (error) {
    if (error instanceof SqlGeneratorError) {
      return res.status(error.status).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Unhandled error:', error);
    return res.status(500).json({
      ok: false,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: 'Unexpected error generating SQL',
      },
    });
  }
});

// POST /api/sql-generator/admin/cache/bust - Bust schema cache (admin only)
router.post('/admin/cache/bust', async (req, res) => {
  // TODO: Add proper admin authentication middleware
  // For now, check for a simple API key
  const apiKey = req.headers['x-admin-api-key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin authentication required',
      },
    });
  }

  try {
    const { manifest, snapshotId } = await bustCache();

    // Reload schema aliases
    reloadPromptAliases();

    return res.json({
      ok: true,
      message: 'Schema cache busted successfully',
      schema_snapshot_id: snapshotId,
      tables_count: manifest.tables.length,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Failed to bust cache:', error);
    return res.status(500).json({
      ok: false,
      error: {
        code: 'CACHE_BUST_FAILED',
        message: 'Failed to bust schema cache',
      },
    });
  }
});

module.exports = router;
