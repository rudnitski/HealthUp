// server/utils/sessionManager.js
// Session management for conversational SQL assistant
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md

const crypto = require('crypto');
const pino = require('pino');

const NODE_ENV = process.env.NODE_ENV || 'development';

const logger = pino({
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session object
    this.MAX_SESSIONS = 100;
    this.SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour idle timeout
    this.MESSAGE_LIMIT = 20;

    // Cleanup stale sessions every 10 minutes
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 10 * 60 * 1000);

    logger.info('[SessionManager] Initialized with config:', {
      max_sessions: this.MAX_SESSIONS,
      ttl_ms: this.SESSION_TTL_MS,
      message_limit: this.MESSAGE_LIMIT
    });
  }

  /**
   * Create a new session
   */
  createSession() {
    this.enforceSessionLimit();

    const session = {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      selectedPatientId: null,
      awaitingPatientSelection: false,
      patients: [],
      patientCount: 0,
      isProcessing: false,
      iterationCount: 0 // Track tool-calling loop iterations (safety limit)
    };

    this.sessions.set(session.id, session);

    logger.info('[SessionManager] Created session:', {
      session_id: session.id,
      total_sessions: this.sessions.size
    });

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Update last activity
      session.lastActivity = new Date();
    }
    return session;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId) {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      logger.info('[SessionManager] Deleted session:', {
        session_id: sessionId,
        remaining_sessions: this.sessions.size
      });
    }
    return existed;
  }

  /**
   * Update session with new message
   */
  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push({ role, content });
    session.lastActivity = new Date();

    return session;
  }

  /**
   * Set selected patient for session
   */
  setSelectedPatient(sessionId, patientId) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.selectedPatientId = patientId;
    session.lastActivity = new Date();

    logger.info('[SessionManager] Set selected patient:', {
      session_id: sessionId,
      patient_id: patientId
    });

    return session;
  }

  /**
   * Mark session as processing
   */
  setProcessing(sessionId, isProcessing) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.isProcessing = isProcessing;
    return session;
  }

  /**
   * Atomic check-and-set for processing lock
   * Returns true if lock acquired, false if already locked
   */
  tryAcquireLock(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    if (session.isProcessing) {
      return false; // Already locked
    }

    session.isProcessing = true;
    return true;
  }

  /**
   * Release processing lock
   */
  releaseLock(sessionId) {
    const session = this.getSession(sessionId);
    if (session) {
      session.isProcessing = false;
    }
  }

  /**
   * Check if message limit reached
   */
  isMessageLimitReached(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    return session.messageCount >= this.MESSAGE_LIMIT;
  }

  /**
   * Enforce session limit by removing oldest session if needed
   */
  enforceSessionLimit() {
    if (this.sessions.size >= this.MAX_SESSIONS) {
      // Remove oldest session by createdAt
      const oldest = Array.from(this.sessions.values())
        .sort((a, b) => a.createdAt - b.createdAt)[0];

      if (oldest) {
        this.sessions.delete(oldest.id);
        logger.warn('[SessionManager] Session limit reached, removed oldest session:', {
          removed_session_id: oldest.id,
          created_at: oldest.createdAt
        });
      }
    }
  }

  /**
   * Clean up stale sessions (idle > TTL)
   */
  cleanupStale() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > this.SESSION_TTL_MS) {
        this.sessions.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('[SessionManager] Cleaned up stale sessions:', {
        cleaned_count: cleanedCount,
        remaining_sessions: this.sessions.size
      });
    }
  }

  /**
   * Mark session as disconnected (for logging purposes)
   */
  markDisconnected(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.disconnectedAt = new Date();
      logger.info('[SessionManager] Session disconnected:', {
        session_id: sessionId,
        will_cleanup_via_ttl: true
      });
    }
  }

  /**
   * Get session statistics
   */
  getStats() {
    return {
      total_sessions: this.sessions.size,
      max_sessions: this.MAX_SESSIONS,
      session_ttl_ms: this.SESSION_TTL_MS,
      message_limit: this.MESSAGE_LIMIT
    };
  }

  /**
   * Clean up on shutdown
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
    logger.info('[SessionManager] Shutdown complete');
  }
}

// Create singleton instance
const sessionManager = new SessionManager();

// Note: Graceful shutdown is handled by server/app.js
// No need to register duplicate SIGTERM/SIGINT handlers here

module.exports = sessionManager;
