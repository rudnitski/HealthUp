const express = require('express');
const { handleGeneration, SqlGeneratorError } = require('../services/sqlGenerator');

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

router.post('/', async (req, res) => {
  const question = req?.body?.question;
  const startedAt = Date.now();

  try {
    const result = await handleGeneration({
      question,
      userIdentifier: getUserIdentifier(req),
      startedAt,
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof SqlGeneratorError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }

    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Unhandled error:', error);
    return res.status(500).json({ error: 'Unexpected error generating SQL' });
  }
});

module.exports = router;
