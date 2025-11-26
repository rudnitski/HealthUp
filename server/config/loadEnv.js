import dotenv from 'dotenv';

// Preload .env for non-production so modules that import env vars during init see them
if (process.env.NODE_ENV !== 'production') {
  const result = dotenv.config();
  if (result.error) {
    console.warn('[env] Failed to load .env:', result.error.message);
  }
}

export {};
