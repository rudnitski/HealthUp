// server/utils/logger.js
// Simple console logger (replacing pino for full visibility)

const logger = {
  info: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.log(`[INFO] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.log(`[INFO] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  },
  warn: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.warn(`[WARN] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.warn(`[WARN] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  },
  error: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.error(`[ERROR] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.error(`[ERROR] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  },
  debug: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.log(`[DEBUG] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.log(`[DEBUG] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  }
};

export default logger;
