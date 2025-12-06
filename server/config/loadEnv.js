import dotenv from 'dotenv';

// Preload .env for non-production so modules that import env vars during init see them
// Use override: true to ensure .env file takes precedence over shell environment variables
// This prevents stale values from persisting across dev restarts (CLAUDE.md gotcha #14)
if (process.env.NODE_ENV !== 'production') {
  const result = dotenv.config({ override: true });
  if (result.error) {
    console.warn('[env] Failed to load .env:', result.error.message);
  }
}

export {};
