// public/js/chat.js
// Conversational SQL Assistant - Chat UI Component
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md
// PRD v4.3: Pre-chat patient selection

class ConversationalSQLChat {
  constructor() {
    this.sessionId = null;
    this.eventSource = null;
    this.isProcessing = false;
    // PRD v4.2.4: Per-message text buffers (replaces single currentAssistantMessage)
    this.messageBuffers = new Map(); // Map<message_id, accumulated_text>
    this.activeTools = new Set(); // Track active tool executions
    this.charts = new Map(); // Track ALL chart instances by canvas ID
    this.parameterSelectorChangeHandler = null; // Track parameter selector listener
    this.plotCounter = 0; // Counter for unique canvas IDs

    // PRD v4.3: Patient selector state
    this.patients = []; // Fetched patient list
    this.selectedPatientId = null; // Currently selected patient
    this.chipsLocked = false; // Lock chips after first message

    // PRD v6.0: Upload state
    this.isUploading = false; // Track upload in progress
    this.currentBatchId = null; // Current batch being uploaded
    this.jobOrderMap = new Map(); // Map<job_id, originalIndex> for file ordering
    this.pollTimer = null; // Polling interval timer
    this.isCancelled = false; // Track if upload was cancelled
    this._onSessionStartResolve = null; // Promise resolver for session_start wait
    this._sessionStartReceived = false; // FIX: Track if session_start already arrived (race condition)

    // DOM elements (will be set when UI is initialized)
    this.chatContainer = null;
    this.messagesContainer = null;
    this.inputTextarea = null;
    this.sendButton = null;
    this.resultsContainer = null;
    this.patientChipsContainer = null; // PRD v4.3
    this.newChatButton = null; // PRD v4.3
    this.chipsScrollLeft = null; // Scroll arrows
    this.chipsScrollRight = null;
    // PRD v6.0: Upload UI elements
    this.attachButton = null;
    this.fileInput = null;
    this.dropOverlay = null;

    // Bind methods
    this.handleSendMessage = this.handleSendMessage.bind(this);
    this.handleKeyPress = this.handleKeyPress.bind(this);
    this.handleNewChat = this.handleNewChat.bind(this); // PRD v4.3
  }

  /**
   * Initialize chat UI
   */
  init(containerElement) {
    this.chatContainer = containerElement;
    this.messagesContainer = this.chatContainer.querySelector('.chat-messages');
    this.inputTextarea = this.chatContainer.querySelector('.chat-input-textarea');
    this.sendButton = this.chatContainer.querySelector('.chat-send-button');
    this.resultsContainer = document.getElementById('sqlResults');

    // PRD v4.3: Patient selector elements
    this.patientChipsContainer = document.getElementById('patient-chips-container');
    this.newChatButton = document.getElementById('new-chat-button');
    this.chipsScrollLeft = document.getElementById('chips-scroll-left');
    this.chipsScrollRight = document.getElementById('chips-scroll-right');

    // Attach event listeners
    this.sendButton.addEventListener('click', this.handleSendMessage);
    this.inputTextarea.addEventListener('keydown', this.handleKeyPress);

    // PRD v4.3: New Chat button
    if (this.newChatButton) {
      this.newChatButton.addEventListener('click', this.handleNewChat);
    }

    // Scroll arrow handlers for patient chips
    this.initChipsScrollHandlers();

    // Attach example prompt click handlers
    this.attachExamplePromptHandlers();

    // PRD v6.0: Initialize upload UI (attachment button, file input, drag-drop)
    this.initUploadUI();

    // PRD v4.3: Fetch patients and initialize selector BEFORE connecting SSE
    this.initPatientSelector();
  }

  /**
   * PRD v5.0: Initialize chat with an existing session (for onboarding)
   * Called when transitioning from landing page with pre-created session
   * @param {HTMLElement} containerElement - Chat container DOM element
   * @param {object} onboardingSession - Session data from handleOnboardingContext()
   * @param {string} onboardingSession.sessionId - Pre-created session ID
   * @param {EventSource} onboardingSession.eventSource - Pre-connected EventSource
   * @param {string} onboardingSession.selectedPatientId - Patient ID
   * @param {string|null} onboardingSession.patientName - Patient display name
   * @param {string} onboardingSession.pendingQuery - Query to auto-submit
   */
  initWithExistingSession(containerElement, { sessionId, eventSource, selectedPatientId, patientName, pendingQuery }) {
    // ============================================================
    // STEP 1: Set up ALL DOM references (must match init() exactly)
    // ============================================================
    this.chatContainer = containerElement;
    this.messagesContainer = this.chatContainer.querySelector('.chat-messages');
    this.inputTextarea = this.chatContainer.querySelector('.chat-input-textarea');
    this.sendButton = this.chatContainer.querySelector('.chat-send-button');
    this.resultsContainer = document.getElementById('sqlResults');

    // PRD v4.3: Patient selector elements (must be set even if locked)
    this.patientChipsContainer = document.getElementById('patient-chips-container');
    this.newChatButton = document.getElementById('new-chat-button');
    this.chipsScrollLeft = document.getElementById('chips-scroll-left');
    this.chipsScrollRight = document.getElementById('chips-scroll-right');

    // ============================================================
    // STEP 2: Attach ALL event listeners (must match init() exactly)
    // ============================================================
    this.sendButton.addEventListener('click', this.handleSendMessage);
    this.inputTextarea.addEventListener('keydown', this.handleKeyPress);

    // PRD v4.3: New Chat button handler
    if (this.newChatButton) {
      this.newChatButton.addEventListener('click', this.handleNewChat);
    }

    // Scroll arrow handlers for patient chips
    this.initChipsScrollHandlers();

    // Example prompt handlers (for empty state)
    this.attachExamplePromptHandlers();

    // PRD v6.0: Initialize upload UI
    this.initUploadUI();

    // ============================================================
    // STEP 3: Use pre-created session (do NOT call initPatientSelector)
    // ============================================================
    this.sessionId = sessionId;
    this.eventSource = eventSource;
    this.selectedPatientId = selectedPatientId;

    // ============================================================
    // STEP 4: Attach SSE handlers BEFORE submitting message
    // CRITICAL: This prevents dropped events from the streamed response
    // ============================================================
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleSSEEvent(data);
      } catch (error) {
        console.error('[Chat] Failed to parse SSE event:', error, event.data);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[Chat] SSE connection error:', error);
      if (this.eventSource.readyState === EventSource.CLOSED) {
        this.showError('Connection lost. Please refresh the page.');
        this.disableInput();
      }
    };

    // ============================================================
    // STEP 5: Lock patient chips (onboarding already selected patient)
    // Use patientName from onboarding context for display (avoids extra fetch)
    // ============================================================
    this.chipsLocked = true;
    this.patients = [{
      id: selectedPatientId,
      display_name: patientName || 'Patient',
      full_name: patientName || null
    }];
    this.selectedPatientId = selectedPatientId;
    this.renderPatientChips();

    // ============================================================
    // STEP 6: Submit pending query with proper UI state management
    // CRITICAL: Add user bubble and set isProcessing BEFORE submitting
    // This mirrors handleSendMessage() behavior for UI consistency
    // ============================================================
    if (pendingQuery) {
      // Add user message bubble (so user sees their question)
      this.addUserMessage(pendingQuery);

      // Set processing state (prevents duplicate submissions)
      this.isProcessing = true;
      this.disableInput();

      // NOW submit the message (SSE handlers already attached above)
      fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionId: this.sessionId,
          message: pendingQuery
        })
      }).then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }).catch(error => {
        console.error('[Chat] Failed to send onboarding message:', error);
        this.showError('Failed to send message. Please try again.');
        this.isProcessing = false;
        this.syncInputState();
      });
    } else {
      // No pending query - just enable input
      this.syncInputState();
    }

    console.log('[Chat] Initialized with existing session:', {
      sessionId,
      selectedPatientId,
      pendingQuery: pendingQuery ? pendingQuery.substring(0, 50) + '...' : null
    });
  }

  /**
   * PRD v4.3: Initialize patient selector
   * Fetches patients sorted by recent activity
   */
  async initPatientSelector() {
    console.log('[Chat] Initializing patient selector...');

    // PRD v4.3: Disable input until session_start event received
    this.disableInput();

    try {
      // PRD v4.4.6: Use endpoint resolver for admin access pattern
      const response = await fetch(window.getReportsEndpoint('/patients') + '?sort=recent');
      if (!response.ok) {
        throw new Error('Failed to fetch patients');
      }

      // PRD v4.3: API returns { patients: [...] }
      const data = await response.json();
      this.patients = data.patients || [];
      console.log('[Chat] Fetched patients:', this.patients.length);

      this.renderPatientChips();

      // PRD v4.3: Auto-select first patient by default
      if (this.patients.length >= 1) {
        // First patient is preselected (whether single or multiple patients)
        await this.selectPatient(this.patients[0].id);
      } else {
        // No patients - show message and allow chat for schema questions
        this.patientChipsContainer.innerHTML = '<span class="patient-chips-empty">No patients found. Upload reports first.</span>';
        // Still allow SSE for schema questions
        await this.createSessionAndConnect(null);
      }
    } catch (error) {
      console.error('[Chat] Failed to initialize patient selector:', error);
      this.showError('Failed to load patients. Please refresh.');
    }
  }

  /**
   * PRD v4.3: Render patient chips
   */
  renderPatientChips() {
    if (!this.patientChipsContainer) return;

    this.patientChipsContainer.innerHTML = '';

    // PRD v4.3: Single-patient behavior - chip is non-interactive
    const isSinglePatient = this.patients.length === 1;

    // PRD v7.0: i18n helper
    const t = window.i18next?.t?.bind(window.i18next);

    this.patients.forEach(patient => {
      const chip = document.createElement('button');
      chip.className = 'patient-chip';
      chip.dataset.patientId = patient.id;
      chip.textContent = patient.display_name || patient.full_name || (t ? t('misc.unknown') : 'Unknown');
      chip.title = patient.full_name || '';

      if (patient.id === this.selectedPatientId) {
        chip.classList.add('patient-chip--selected');
      }

      if (this.chipsLocked) {
        chip.classList.add('patient-chip--locked');
      }

      // PRD v4.3: Single patient - non-interactive with tooltip
      if (isSinglePatient) {
        chip.classList.add('patient-chip--single');
        chip.title = t ? t('chat:patientSelector.singlePatient') : 'Only one patient in system';
        chip.disabled = true;
      } else {
        chip.addEventListener('click', () => {
          if (!this.chipsLocked && !this.isProcessing) {
            this.selectPatient(patient.id);
          }
        });
      }

      this.patientChipsContainer.appendChild(chip);
    });

    // Update scroll arrow visibility after chips are rendered
    requestAnimationFrame(() => this.updateChipsScrollArrows());
  }

  /**
   * Initialize scroll handlers for patient chips
   */
  initChipsScrollHandlers() {
    if (!this.patientChipsContainer) return;

    const scrollAmount = 200; // Pixels to scroll per click

    // Left arrow click
    if (this.chipsScrollLeft) {
      this.chipsScrollLeft.addEventListener('click', () => {
        this.patientChipsContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
      });
    }

    // Right arrow click
    if (this.chipsScrollRight) {
      this.chipsScrollRight.addEventListener('click', () => {
        this.patientChipsContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
      });
    }

    // Update arrows on scroll
    this.patientChipsContainer.addEventListener('scroll', () => {
      this.updateChipsScrollArrows();
    });

    // Update arrows on window resize
    window.addEventListener('resize', () => {
      this.updateChipsScrollArrows();
    });
  }

  /**
   * Update scroll arrow visibility based on scroll position
   */
  updateChipsScrollArrows() {
    if (!this.patientChipsContainer || !this.chipsScrollLeft || !this.chipsScrollRight) return;

    const container = this.patientChipsContainer;
    const scrollLeft = container.scrollLeft;
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;

    // Show left arrow if scrolled right
    const canScrollLeft = scrollLeft > 1;
    // Show right arrow if more content to the right
    const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1;

    this.chipsScrollLeft.hidden = !canScrollLeft;
    this.chipsScrollRight.hidden = !canScrollRight;
  }

  /**
   * PRD v4.3: Select patient and create session
   */
  async selectPatient(patientId) {
    if (this.chipsLocked) {
      console.warn('[Chat] Patient chips are locked');
      return;
    }

    console.log('[Chat] Selecting patient:', patientId);
    this.selectedPatientId = patientId;

    // Update chip UI
    this.renderPatientChips();

    // Create session with selected patient
    await this.createSessionAndConnect(patientId);
  }

  /**
   * PRD v4.3: Create session and connect SSE
   */
  async createSessionAndConnect(patientId) {
    console.log('[Chat] Creating session with patient:', patientId);

    try {
      // Step 1: Create session via POST /api/chat/sessions
      const createResponse = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedPatientId: patientId })
      });

      if (!createResponse.ok) {
        const error = await createResponse.json();
        throw new Error(error.error || 'Failed to create session');
      }

      const { sessionId } = await createResponse.json();
      this.sessionId = sessionId;
      console.log('[Chat] Session created:', sessionId);

      // Step 2: Preflight validation via HEAD /api/chat/sessions/:id/validate
      const validateResponse = await fetch(`/api/chat/sessions/${sessionId}/validate`, {
        method: 'HEAD'
      });

      if (!validateResponse.ok) {
        throw new Error('Session validation failed');
      }

      // Step 3: Connect SSE with sessionId
      this.connectSSE(sessionId);

    } catch (error) {
      console.error('[Chat] Session creation failed:', error);
      this.showError(`Failed to start chat: ${error.message}`);
    }
  }

  /**
   * PRD v4.3: Handle New Chat button
   */
  handleNewChat() {
    console.log('[Chat] New chat requested');
    const lastSelectedPatientId = this.selectedPatientId;

    // Close existing SSE
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Delete current session (fire-and-forget)
    if (this.sessionId) {
      fetch(`/api/chat/sessions/${this.sessionId}`, { method: 'DELETE' }).catch(() => { });
    }

    // Reset state
    this.sessionId = null;
    this.selectedPatientId = null;
    this.chipsLocked = false;
    this.isProcessing = false;
    this.messageBuffers.clear();
    this.activeTools.clear();

    // PRD v4.3: Destroy Chart.js instances to prevent memory leaks
    this.charts.forEach(chart => {
      try {
        chart.destroy();
      } catch (e) {
        console.warn('[Chat] Error destroying chart:', e);
      }
    });
    this.charts.clear();
    this.plotCounter = 0; // Reset plot counter for fresh canvas IDs

    // Clear messages
    if (this.messagesContainer) {
      // Keep empty state, remove messages
      const emptyState = this.messagesContainer.querySelector('.chat-empty-state');
      this.messagesContainer.innerHTML = '';
      if (emptyState) {
        this.messagesContainer.appendChild(emptyState.cloneNode(true));
      }
    }

    // Re-render chips (unlocked)
    this.renderPatientChips();

    // Disable input until patient selected
    this.disableInput();

    // Re-attach example prompt handlers for restored empty state
    this.attachExamplePromptHandlers();

    // Auto-start a fresh session with the previously selected (or first) patient
    const nextPatientId = this.patients.find(p => p.id === lastSelectedPatientId)?.id
      || this.patients[0]?.id
      || null;
    if (nextPatientId) {
      this.selectPatient(nextPatientId);
    } else {
      // No patients yet - allow schema questions without a patient context
      this.createSessionAndConnect(null);
    }
  }

  /**
   * Attach click handlers to example prompts
   * PRD v7.0: Use visible (translated) text so LLM responds in user's language
   */
  attachExamplePromptHandlers() {
    const examplePrompts = this.chatContainer.querySelectorAll('.chat-example-prompt');
    examplePrompts.forEach(button => {
      button.addEventListener('click', () => {
        // Use translated visible text instead of data-prompt for localized experience
        const promptTextEl = button.querySelector('.prompt-text');
        const prompt = promptTextEl ? promptTextEl.textContent : button.dataset.prompt;
        if (prompt && !this.isProcessing) {
          this.inputTextarea.value = prompt;
          this.handleSendMessage();
        }
      });
    });
  }

  /**
   * Connect to SSE stream
   * PRD v4.3: Now requires sessionId parameter
   */
  connectSSE(sessionId) {
    if (!sessionId) {
      console.error('[Chat] Cannot connect SSE without sessionId');
      return;
    }

    console.log('[Chat] Connecting to SSE stream for session:', sessionId);

    // Close existing connection if any
    if (this.eventSource) {
      this.eventSource.close();
    }

    // PRD v4.3: Pass sessionId as query parameter
    // PRD v4.4.4: Use auth-aware EventSource for 401 handling
    this.eventSource = window.createAuthAwareEventSource(`/api/chat/stream?sessionId=${sessionId}`);

    this.eventSource.onopen = () => {
      console.log('[Chat] SSE connection opened');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleSSEEvent(data);
      } catch (error) {
        console.error('[Chat] Failed to parse SSE event:', error, event.data);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('[Chat] SSE connection error:', error);

      if (this.eventSource.readyState === EventSource.CLOSED) {
        this.showError('Connection lost. Please refresh the page to start a new conversation.');
        this.disableInput();
      }
    };
  }

  /**
   * Handle SSE events from server
   */
  handleSSEEvent(data) {
    console.log('[Chat] SSE event:', data.type, data);

    switch (data.type) {
      case 'session_start':
        this.sessionId = data.sessionId;
        console.log('[Chat] Session started:', this.sessionId);
        this.syncInputState();
        // PRD v6.0: Mark session as started and resolve promise if pending
        // FIX: Set flag first so waitForSessionStart() can resolve immediately if called later
        this._sessionStartReceived = true;
        if (this._onSessionStartResolve) {
          this._onSessionStartResolve();
          this._onSessionStartResolve = null;
        }
        break;

      case 'message_start':
        console.log('[Chat] Message started:', data.message_id);
        break;

      case 'message_end':
        // PRD v4.2.4: Finalize message by message_id
        this.hideStatusIndicator();
        // CRITICAL: Only finalize if we actually streamed text this turn
        // This guard prevents:
        // 1. Double-finalization on error path
        // 2. Clobbering previous messages on tool-only turns
        // 3. Finalizing empty messages on error-only responses
        if (data.message_id && this.messageBuffers.has(data.message_id)) {
          this.finalizeAssistantMessage(data.message_id);
        }
        // Check for thumbnail stack margin adjustment (PRD v4.2.4)
        this.adjustThumbnailStackMargin(data.message_id);

        // PRD v4.3: Lock patient chips after first message exchange
        if (!this.chipsLocked) {
          this.chipsLocked = true;
          this.renderPatientChips();
        }

        // PRD v6.0: Reset isProcessing BEFORE syncInputState so input gets enabled
        this.isProcessing = false;
        this.syncInputState();
        break;

      case 'text':
        // PRD v4.2.4: Pass message_id for per-message text accumulation
        this.appendAssistantText(data.message_id, data.content);
        break;

      case 'tool_start':
        this.showToolIndicator(data.tool, data.params);
        break;

      case 'tool_complete':
        this.hideToolIndicator(data.tool);
        break;

      case 'status':
        // PRD v7.0: Translate known status messages
        const t = window.i18next?.t?.bind(window.i18next);
        let statusMessage = data.message;
        if (t && data.status === 'thinking') {
          statusMessage = t('chat:thinking');
        }
        this.showStatusIndicator(data.status, statusMessage);
        break;

      case 'plot_result':
        this.handlePlotResult(data);
        break;

      case 'table_result':
        this.handleTableResult(data);
        break;

      case 'thumbnail_update':
        // PRD v4.2.4: Render thumbnail into message bubble
        console.log('[v4.2.4] thumbnail_update:', {
          message_id: data.message_id,
          plot_title: data.plot_title,
          thumbnail: data.thumbnail
        });
        this.renderThumbnail(data.message_id, data.plot_title, data.result_id, data.thumbnail, data.replace_previous);
        break;

      case 'error':
        this.handleError(data);
        break;

      default:
        console.warn('[Chat] Unknown event type:', data.type);
    }
  }

  /**
   * Handle user sending a message
   */
  async handleSendMessage() {
    const message = this.inputTextarea.value.trim();

    if (!message) {
      return;
    }

    if (!this.sessionId) {
      this.showError('Session not initialized. Please wait...');
      return;
    }

    if (this.isProcessing) {
      this.showError('Please wait for the assistant to finish responding.');
      return;
    }

    // Add user message to chat
    this.addUserMessage(message);

    // Clear input
    this.inputTextarea.value = '';

    // Disable input while processing
    this.disableInput();
    this.isProcessing = true;

    // Send message to server
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          message: message
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send message');
      }

      // Message accepted, wait for SSE events
      console.log('[Chat] Message sent successfully');

    } catch (error) {
      console.error('[Chat] Failed to send message:', error);
      this.showError(`Failed to send message: ${error.message}`);
      this.isProcessing = false;
      this.syncInputState();
    }
  }

  /**
   * Handle Enter key press (send message)
   */
  handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSendMessage();
    }
  }

  /**
   * Add user message bubble to chat
   */
  addUserMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message chat-message-user';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-user';
    bubble.textContent = text;

    messageDiv.appendChild(bubble);
    this.messagesContainer.appendChild(messageDiv);

    // Scroll to bottom
    this.scrollToBottom();
  }

  /**
   * PRD v4.2.4: Create or get message shell for assistant message
   * Creates on-demand when first text or thumbnail arrives
   * @param {string} messageId - UUID for the message
   * @returns {HTMLElement} - The message shell element
   */
  getOrCreateMessageShell(messageId) {
    // Check if shell already exists (deduplication)
    let messageShell = this.messagesContainer.querySelector(`[data-message-id="${messageId}"]`);

    if (!messageShell) {
      // Create new message shell with PRD v4.2.4 DOM structure
      messageShell = document.createElement('div');
      messageShell.className = 'chat-message chat-message-assistant';
      messageShell.setAttribute('data-message-id', messageId);

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble-assistant';

      // PRD v4.2.4: Two sibling containers inside bubble
      const contentDiv = document.createElement('div');
      contentDiv.className = 'chat-bubble-content markdown-content';

      const thumbnailStack = document.createElement('div');
      thumbnailStack.className = 'thumbnail-stack';

      bubble.appendChild(contentDiv);
      bubble.appendChild(thumbnailStack);
      messageShell.appendChild(bubble);
      this.messagesContainer.appendChild(messageShell);
    }

    return messageShell;
  }

  /**
   * Append text to assistant message (streaming)
   * PRD v4.2.4: Uses per-message buffers and message_id-based DOM targeting
   * @param {string} messageId - UUID for the message
   * @param {string} text - Text chunk to append
   */
  appendAssistantText(messageId, text) {
    if (!messageId) {
      console.error('[Chat] appendAssistantText called without message_id');
      return;
    }

    // Accumulate text in per-message buffer
    const buffer = this.messageBuffers.get(messageId) || '';
    this.messageBuffers.set(messageId, buffer + text);

    // Get or create message shell (on-demand creation)
    const messageShell = this.getOrCreateMessageShell(messageId);

    // Hide status indicator on first text chunk
    if (!buffer) {
      this.hideStatusIndicator();
    }

    // Find the content container using message_id-based selector (PRD v4.2.4 requirement)
    const contentEl = messageShell.querySelector('.chat-bubble-content');
    if (!contentEl) {
      console.error('[Chat] Could not find .chat-bubble-content in message shell');
      return;
    }

    // Parse markdown and sanitize HTML
    const rawHtml = marked.parse(this.messageBuffers.get(messageId));
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['span'],
      ADD_ATTR: ['class']
    });

    // Update content (targets .chat-bubble-content, preserving .thumbnail-stack)
    contentEl.innerHTML = cleanHtml;

    // Add cursor as a separate element to avoid it being removed by sanitizer
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    cursor.textContent = '|';
    contentEl.appendChild(cursor);

    // Only auto-scroll if user is near bottom (within 100px)
    this.scrollToBottomIfNearBottom();
  }

  /**
   * Finalize assistant message (remove cursor)
   * PRD v4.2.4: Uses message_id for per-message targeting
   * @param {string} messageId - UUID for the message to finalize
   */
  finalizeAssistantMessage(messageId) {
    if (!messageId) {
      console.error('[Chat] finalizeAssistantMessage called without message_id');
      return;
    }

    if (!messageId || !this.messageBuffers.has(messageId)) {
      return;
    }

    // Find message element using message_id-based selector (PRD v4.2.4)
    const messageShell = this.messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    const contentEl = messageShell?.querySelector('.chat-bubble-content');

    if (contentEl) {
      // Parse markdown and sanitize HTML (final render without cursor)
      const rawHtml = marked.parse(this.messageBuffers.get(messageId));
      const cleanHtml = DOMPurify.sanitize(rawHtml);
      contentEl.innerHTML = cleanHtml;
    }

    // Clear the buffer for this message
    this.messageBuffers.delete(messageId);
  }

  /**
   * PRD v4.2.4: Adjust thumbnail stack margin based on text content presence
   * Called on message_end to finalize layout
   * @param {string} messageId - UUID for the message
   */
  adjustThumbnailStackMargin(messageId) {
    if (!messageId) return;

    const messageShell = this.messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageShell) return;

    const contentEl = messageShell.querySelector('.chat-bubble-content');
    const thumbnailStack = messageShell.querySelector('.thumbnail-stack');

    if (!thumbnailStack || thumbnailStack.children.length === 0) return;

    // Check if text content is empty (after cursor removal)
    const hasTextContent = contentEl && contentEl.textContent.trim() !== '';

    if (!hasTextContent) {
      thumbnailStack.classList.add('thumbnail-stack--no-text-above');
    } else {
      thumbnailStack.classList.remove('thumbnail-stack--no-text-above');
    }
  }

  /**
   * PRD v4.2.4: Render thumbnail card into assistant message
   * @param {string} messageId - UUID for the assistant message
   * @param {string} plotTitle - Authoritative plot title (top-level)
   * @param {string} resultId - Unique result ID for this thumbnail
   * @param {object} thumbnail - Thumbnail data from backend
   * @param {boolean} replacePrevious - If true, remove most recent thumbnail first
   */
  renderThumbnail(messageId, plotTitle, resultId, thumbnail, replacePrevious) {
    if (!messageId || !thumbnail) {
      console.error('[Chat] renderThumbnail: missing messageId or thumbnail');
      return;
    }

    // Validate required fields (PRD v4.2.4 contract)
    const requiredFields = ['status', 'point_count', 'series_count'];
    const validStatuses = ['normal', 'high', 'low', 'unknown'];

    for (const field of requiredFields) {
      if (thumbnail[field] === undefined || thumbnail[field] === null) {
        console.error(`[Chat] renderThumbnail: missing required field "${field}" (contract violation)`);
        return;
      }
    }

    if (!validStatuses.includes(thumbnail.status)) {
      console.error(`[Chat] renderThumbnail: invalid status "${thumbnail.status}" (contract violation)`);
      return;
    }

    if (!thumbnail.sparkline?.series || !Array.isArray(thumbnail.sparkline.series) || thumbnail.sparkline.series.length === 0) {
      console.error('[Chat] renderThumbnail: missing or empty sparkline.series (contract violation)');
      return;
    }

    // Get or create message shell
    const messageShell = this.getOrCreateMessageShell(messageId);
    const thumbnailStack = messageShell.querySelector('.thumbnail-stack');

    if (!thumbnailStack) {
      console.error('[Chat] renderThumbnail: could not find .thumbnail-stack');
      return;
    }

    // Handle replace_previous flag (PRD v4.2.2)
    if (replacePrevious && thumbnailStack.children.length > 0) {
      thumbnailStack.removeChild(thumbnailStack.lastChild);
    }

    // Create thumbnail card
    const card = document.createElement('div');
    card.className = 'thumbnail-card';
    card.setAttribute('data-result-id', resultId || '');

    // === Header section ===
    const header = document.createElement('div');
    header.className = 'thumbnail-header';

    const title = document.createElement('div');
    title.className = 'thumbnail-title';
    title.textContent = plotTitle || 'Untitled';
    header.appendChild(title);

    // Optional subtitle (focus_analyte_name)
    if (thumbnail.focus_analyte_name) {
      const subtitle = document.createElement('div');
      subtitle.className = 'thumbnail-subtitle';
      subtitle.textContent = thumbnail.focus_analyte_name;
      header.appendChild(subtitle);
    }

    card.appendChild(header);

    // === Primary value row ===
    const primary = document.createElement('div');
    primary.className = 'thumbnail-primary';

    const valueDiv = document.createElement('div');
    valueDiv.className = 'thumbnail-value';

    // Format latest_value per PRD v4.2.4
    const formattedValue = this.formatLatestValue(thumbnail.latest_value);
    if (formattedValue === '—') {
      valueDiv.textContent = '—';
    } else {
      // Concatenate with unit_display (which includes leading space per backend contract)
      valueDiv.textContent = formattedValue + (thumbnail.unit_display || '');
    }

    primary.appendChild(valueDiv);

    // Status pill (required field)
    const statusPill = document.createElement('div');
    statusPill.className = `thumbnail-status status-${thumbnail.status}`;
    statusPill.textContent = this.formatStatusLabel(thumbnail.status);
    primary.appendChild(statusPill);

    card.appendChild(primary);

    // === Delta row (optional) ===
    if (this.shouldShowDeltaRow(thumbnail)) {
      const deltaRow = this.createDeltaRow(thumbnail);
      if (deltaRow) {
        card.appendChild(deltaRow);
      }
    }

    // === Sparkline ===
    const sparklineContainer = document.createElement('div');
    sparklineContainer.className = 'thumbnail-sparkline';
    sparklineContainer.setAttribute('aria-label', `Trend for ${plotTitle || 'data'}`);

    const sparklineSvg = this.createSparklineSvg(thumbnail.sparkline.series);
    if (sparklineSvg) {
      sparklineContainer.appendChild(sparklineSvg);
    }

    card.appendChild(sparklineContainer);

    // === Footer ===
    const footer = document.createElement('div');
    footer.className = 'thumbnail-footer';

    // Point count (always show, even if 0)
    const pointMeta = document.createElement('span');
    pointMeta.className = 'thumbnail-meta';
    const pointCount = thumbnail.point_count;
    pointMeta.textContent = pointCount === 1 ? '1 point' : `${pointCount} points`;
    footer.appendChild(pointMeta);

    // Series count (show only if > 1)
    if (thumbnail.series_count > 1) {
      const seriesMeta = document.createElement('span');
      seriesMeta.className = 'thumbnail-meta';
      seriesMeta.textContent = `${thumbnail.series_count} series`;
      footer.appendChild(seriesMeta);
    }

    card.appendChild(footer);

    // Append to stack
    thumbnailStack.appendChild(card);

    // Scroll to show thumbnail if near bottom
    this.scrollToBottomIfNearBottom();
  }

  /**
   * PRD v4.2.4: Format latest_value for display
   * @param {number|string|null} value - The value to format
   * @returns {string} - Formatted value or "—" placeholder
   */
  formatLatestValue(value) {
    if (value === null || value === undefined) {
      return '—';
    }

    let numValue;
    if (typeof value === 'number') {
      numValue = value;
    } else if (typeof value === 'string') {
      // Strict parsing per PRD v4.2.4
      if (value.trim() === '') {
        return '—';
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return '—';
      }
      numValue = parsed;
    } else {
      return '—';
    }

    if (!Number.isFinite(numValue)) {
      return '—';
    }

    // Format with Intl.NumberFormat (automatically trims trailing zeros)
    const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
    return formatter.format(numValue);
  }

  /**
   * PRD v4.2.4: Format status enum to display label
   * @param {string} status - Status enum value
   * @returns {string} - Display label
   */
  formatStatusLabel(status) {
    const labels = {
      'normal': 'Normal',
      'high': 'High',
      'low': 'Low',
      'unknown': 'Unknown'
    };
    return labels[status] || 'Unknown';
  }

  /**
   * PRD v4.2.4: Check if delta row should be shown
   * Requires all three: delta_pct, delta_direction, delta_period
   * @param {object} thumbnail - Thumbnail data
   * @returns {boolean}
   */
  shouldShowDeltaRow(thumbnail) {
    return (
      thumbnail.delta_pct !== null &&
      thumbnail.delta_pct !== undefined &&
      thumbnail.delta_direction !== null &&
      thumbnail.delta_direction !== undefined &&
      thumbnail.delta_period !== null &&
      thumbnail.delta_period !== undefined
    );
  }

  /**
   * PRD v4.2.4: Create delta row element
   * @param {object} thumbnail - Thumbnail data
   * @returns {HTMLElement|null} - Delta row element or null if validation fails
   */
  createDeltaRow(thumbnail) {
    const { delta_pct, delta_direction, delta_period } = thumbnail;

    // Defensive validation: sign/direction consistency check
    const absDelta = Math.abs(delta_pct);
    const expectedDirection = absDelta <= 1 ? 'stable' : delta_pct > 1 ? 'up' : 'down';

    if (delta_direction !== expectedDirection) {
      console.warn(`[Thumbnail] Delta sign/direction mismatch: ${delta_pct} vs ${delta_direction}`);
      return null; // Contract violation - hide delta row
    }

    const deltaRow = document.createElement('div');
    deltaRow.className = 'thumbnail-delta';

    // Delta icon
    const iconSpan = document.createElement('span');
    iconSpan.className = `delta-icon delta-${delta_direction}`;
    switch (delta_direction) {
      case 'up':
        iconSpan.textContent = '▲';
        break;
      case 'down':
        iconSpan.textContent = '▼';
        break;
      case 'stable':
      default:
        iconSpan.textContent = '—';
        break;
    }
    deltaRow.appendChild(iconSpan);

    // Delta value (formatted)
    const valueSpan = document.createElement('span');
    valueSpan.className = 'delta-value';
    valueSpan.textContent = this.formatDeltaPct(delta_pct, delta_direction);
    deltaRow.appendChild(valueSpan);

    // Delta period (expanded)
    const periodSpan = document.createElement('span');
    periodSpan.className = 'delta-period';
    periodSpan.textContent = this.formatDeltaPeriod(delta_period);
    deltaRow.appendChild(periodSpan);

    return deltaRow;
  }

  /**
   * PRD v4.2.4: Format delta percentage
   * @param {number} deltaPct - Signed percentage value
   * @param {string} direction - up, down, or stable
   * @returns {string} - Formatted percentage string
   */
  formatDeltaPct(deltaPct, direction) {
    const absDelta = Math.abs(deltaPct);

    // Very small changes: show <0.1%
    if (absDelta <= 0.1) {
      return '<0.1%';
    }

    // Stable direction (backend threshold: ≤1%) but >0.1%: show ~0%
    if (direction === 'stable') {
      return '~0%';
    }

    // Significant changes: show actual percentage with sign
    const formatted = absDelta.toFixed(1);
    const sign = direction === 'up' ? '+' : direction === 'down' ? '-' : '';
    return `${sign}${formatted}%`;
  }

  /**
   * PRD v4.2.4: Format delta period (expand shorthand)
   * @param {string} deltaPeriod - Period string (e.g., "3m", "1y", "14d")
   * @returns {string} - Expanded period (e.g., "over 3 months")
   */
  formatDeltaPeriod(deltaPeriod) {
    if (!deltaPeriod) return '';

    // Strict pattern: digits + lowercase unit letter only
    const periodPattern = /^(\d+)(y|m|w|d)$/;
    const match = deltaPeriod.match(periodPattern);

    if (match) {
      const [, num, unit] = match;
      const unitMap = { y: 'year', m: 'month', w: 'week', d: 'day' };
      const unitName = unitMap[unit];
      const plural = parseInt(num) !== 1 ? 's' : '';
      return `over ${num} ${unitName}${plural}`;
    }

    // Render as-is if not shorthand format
    return deltaPeriod;
  }

  /**
   * PRD v4.2.4: Create sparkline SVG using createElementNS (XSS-safe)
   * @param {number[]} series - Array of 1-30 numeric values
   * @returns {SVGElement|null} - SVG element or null if invalid
   */
  createSparklineSvg(series) {
    if (!Array.isArray(series)) return null;

    // Slice to max 30 values (defensive)
    let values = series.slice(0, 30);

    // Filter to finite numbers only
    values = values.filter(v => Number.isFinite(v));

    if (values.length === 0) return null;

    // Compute min/max
    const min = Math.min(...values);
    const max = Math.max(...values);

    let points;

    if (min === max || values.length === 1) {
      // Flat line at 50% height
      points = '0,12 100,12';
    } else {
      // Map values to viewBox coordinates
      points = values.map((v, i) => {
        const x = values.length === 1 ? 50 : (i / (values.length - 1)) * 100;
        const y = 22 - ((v - min) / (max - min)) * 20; // y in [2, 22] range
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
    }

    // Create SVG using createElementNS (XSS-safe per PRD v4.2.4)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 24');
    svg.setAttribute('preserveAspectRatio', 'none');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke', 'var(--thumbnail-sparkline)');
    polyline.setAttribute('stroke-opacity', '0.45');
    polyline.setAttribute('stroke-width', '1.5');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(polyline);
    return svg;
  }

  /**
   * Show tool execution indicator
   */
  showToolIndicator(toolName, params) {
    // Clear any status indicator when tool starts
    this.hideStatusIndicator();

    this.activeTools.add(toolName);

    // Create or update tool indicators container
    let indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');

    if (!indicatorsContainer) {
      indicatorsContainer = document.createElement('div');
      indicatorsContainer.className = 'tool-indicators';
      this.messagesContainer.appendChild(indicatorsContainer);
    }

    const indicator = document.createElement('div');
    indicator.className = 'tool-indicator';
    indicator.dataset.tool = toolName;
    indicator.innerHTML = `<span class="tool-spinner"></span> ${this.getToolDisplayName(toolName)}`;

    indicatorsContainer.appendChild(indicator);

    this.scrollToBottom();
  }

  /**
   * Hide tool execution indicator
   */
  hideToolIndicator(toolName) {
    this.activeTools.delete(toolName);

    const indicator = this.messagesContainer.querySelector(`.tool-indicator[data-tool="${toolName}"]`);
    if (indicator) {
      indicator.remove();
    }

    // Remove container if no more active tools
    if (this.activeTools.size === 0) {
      const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
      if (indicatorsContainer) {
        indicatorsContainer.remove();
      }
    }
  }

  /**
   * Show status indicator (non-tool statuses like "Thinking...", "Validating query...")
   * Replaces any existing status indicator with the new one
   */
  showStatusIndicator(statusType, message) {
    // Remove any existing status indicator first
    this.hideStatusIndicator();

    // Create or get indicators container
    let indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');

    if (!indicatorsContainer) {
      indicatorsContainer = document.createElement('div');
      indicatorsContainer.className = 'tool-indicators';
      this.messagesContainer.appendChild(indicatorsContainer);
    }

    const indicator = document.createElement('div');
    indicator.className = 'tool-indicator status-indicator';
    indicator.dataset.status = statusType;
    indicator.innerHTML = `<span class="tool-spinner"></span> ${message}`;

    indicatorsContainer.appendChild(indicator);

    this.scrollToBottom();
  }

  /**
   * Hide status indicator
   */
  hideStatusIndicator() {
    const indicator = this.messagesContainer.querySelector('.status-indicator');
    if (indicator) {
      indicator.remove();
    }

    // Remove container if no more indicators (tools or status)
    const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
    if (indicatorsContainer && indicatorsContainer.children.length === 0) {
      indicatorsContainer.remove();
    }
  }

  /**
   * Get human-readable tool name
   * PRD v7.0: i18n support for tool indicators
   */
  getToolDisplayName(toolName) {
    const t = window.i18next?.t?.bind(window.i18next);
    const displayNames = {
      'fuzzy_search_parameter_names': t ? t('chat:toolIndicators.searchingParameters') : 'Searching parameters...',
      'fuzzy_search_analyte_names': t ? t('chat:toolIndicators.searchingAnalytes') : 'Searching lab tests...',
      'execute_exploratory_sql': t ? t('chat:toolIndicators.executingQuery') : 'Exploring database...',
      'show_plot': t ? t('chat:toolIndicators.generatingPlot') : 'Validating and fetching data...',
      'show_table': t ? t('chat:toolIndicators.preparingResults') : 'Validating and fetching data...'
    };

    return displayNames[toolName] || toolName;
  }

  /**
   * Handle plot result (v3.3)
   * PRD v4.7: Always clear previous visualization (single-visualization mode)
   */
  handlePlotResult(data) {
    console.log('[Chat] Plot result received:', data);

    const { plot_title, rows, message_id } = data;
    // Note: replace_previous is ignored per PRD v4.7 - always clear

    // Finalize assistant message if any (PRD v4.2.4: use message_id)
    this.finalizeAssistantMessage(message_id);

    // Clear all tool indicators (cleanup)
    const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
    if (indicatorsContainer) {
      indicatorsContainer.remove();
    }
    this.activeTools.clear();

    // PRD v4.7: ALWAYS clear previous visualization (remove replace_previous conditional)
    // CRITICAL: Destroy ALL charts before clearing DOM to prevent memory leaks
    this.destroyAllCharts();
    this.resultsContainer.innerHTML = '';

    // Show results container
    this.resultsContainer.style.display = 'block';

    // Display plot
    this.displayPlotResults(rows, null, plot_title);

    // Scroll to results
    this.resultsContainer.scrollIntoView({ behavior: 'smooth' });

    // Continue conversation - don't end processing
    // NOTE: Do NOT reset isProcessing here - LLM may still be generating text after show_plot
    // The isProcessing flag is reset on message_end only
    this.syncInputState();
  }

  /**
   * Handle table result (v3.3)
   * PRD v4.7: Always clear previous visualization (single-visualization mode)
   */
  handleTableResult(data) {
    console.log('[Chat] Table result received:', data);

    const { table_title, rows, message_id } = data;
    // Note: replace_previous is ignored per PRD v4.7 - always clear

    // Finalize assistant message if any (PRD v4.2.4: use message_id)
    this.finalizeAssistantMessage(message_id);

    // Clear all tool indicators (cleanup)
    const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
    if (indicatorsContainer) {
      indicatorsContainer.remove();
    }
    this.activeTools.clear();

    // PRD v4.7: ALWAYS clear previous visualization (remove replace_previous conditional)
    // CRITICAL: Destroy ALL charts BEFORE clearing DOM to prevent memory leaks
    // (This handles case where table result replaces a plot result)
    this.destroyAllCharts();
    this.resultsContainer.innerHTML = '';

    // Show results container
    this.resultsContainer.style.display = 'block';

    // Display table
    this.displayTableResults(rows, table_title);

    // Scroll to results
    this.resultsContainer.scrollIntoView({ behavior: 'smooth' });

    // Continue conversation - don't end processing
    // NOTE: Do NOT reset isProcessing here - LLM may still be generating text after show_table
    // The isProcessing flag is reset on message_end only
    this.syncInputState();
  }

  /**
   * Build parameter selector UI from plot data
   * @param {Array} rows - Full dataset with parameter_name field
   * @param {HTMLElement} container - Container element for radio buttons
   * @returns {string|null} - Selected parameter name (default: first alphabetically)
   */
  renderParameterSelector(rows, container) {
    if (!container) return null;

    // Extract unique parameters, sorted alphabetically
    const paramCounts = {};
    rows.forEach(row => {
      const param = row.parameter_name;
      if (param) {
        paramCounts[param] = (paramCounts[param] || 0) + 1;
      }
    });

    const parameters = Object.keys(paramCounts).sort();
    if (parameters.length === 0) return null;

    // Build radio button list
    const fragment = document.createDocumentFragment();
    parameters.forEach((param, index) => {
      const label = document.createElement('label');
      label.className = 'parameter-selector-item';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'chat-parameter';
      radio.value = param;
      radio.checked = index === 0; // Default: first alphabetically

      // If only one parameter, disable the radio (make it look static)
      if (parameters.length === 1) {
        radio.disabled = true;
      }

      const text = document.createTextNode(` ${param} (${paramCounts[param]})`);

      label.appendChild(radio);
      label.appendChild(text);
      fragment.appendChild(label);
    });

    container.replaceChildren(fragment);
    container.style.display = 'block';

    return parameters[0]; // Return default selection
  }

  /**
   * Attach event listener for parameter switching
   * PRD v4.7: Added plotSection parameter, resets view to Plot on parameter change
   * @param {Array} allRowsForPlot - Full dataset without out-of-range flags (for plot)
   * @param {Array} allRowsOriginal - Full dataset with out-of-range flags (for table)
   * @param {HTMLElement} container - Parameter selector container
   * @param {string} canvasId - Canvas ID for plot
   * @param {string} plotTitle - Base plot title
   * @param {HTMLElement} plotSection - The root .chat-plot-visualization element
   */
  attachParameterSelectorListener(allRowsForPlot, allRowsOriginal, container, canvasId, plotTitle, plotSection) {
    if (!container) return;

    // Remove existing listener if any
    if (this.parameterSelectorChangeHandler) {
      container.removeEventListener('change', this.parameterSelectorChangeHandler);
    }

    this.parameterSelectorChangeHandler = (event) => {
      if (event.target.type === 'radio' && event.target.name === 'chat-parameter') {
        const selectedParameter = event.target.value;

        // Filter data client-side (plot version without out-of-range flags)
        const filteredRowsForPlot = allRowsForPlot.filter(row => row.parameter_name === selectedParameter);

        // Filter original data (table version with out-of-range flags)
        const filteredRowsOriginal = allRowsOriginal.filter(row => row.parameter_name === selectedParameter);

        // PRD v4.7: Reset view to Plot on parameter change
        // Sequence: update tab state → update panel visibility → resize chart in rAF
        if (plotSection) {
          this.switchView(plotSection, 'plot', canvasId);
        }

        // Destroy existing chart for this canvas
        const existingChart = this.charts.get(canvasId);
        if (existingChart && window.plotRenderer) {
          window.plotRenderer.destroyChart(existingChart);
        }

        // Re-render with filtered data (without out-of-range flags)
        const newChart = window.plotRenderer.renderPlot(canvasId, filteredRowsForPlot, {
          title: selectedParameter || plotTitle,
          xAxisLabel: 'Date',
          yAxisLabel: 'Value',
          timeUnit: 'day'
        });

        // Track the chart instance
        this.charts.set(canvasId, newChart);

        // PRD v4.7: Update table in the Table view panel (instead of separate container)
        if (plotSection) {
          this.renderTableInView(plotSection, filteredRowsOriginal, selectedParameter);
        }
      }
    };

    container.addEventListener('change', this.parameterSelectorChangeHandler);
  }

  /**
   * Render parameter table below plot
   * @param {Array} rows - Filtered dataset for selected parameter
   * @param {string} parameterName - Currently selected parameter name
   */
  renderParameterTable(rows, parameterName) {
    const tableContainer = this.resultsContainer.querySelector('.chat-parameter-table-container');
    if (!tableContainer) return;

    // Hide table if no data
    if (!rows || rows.length === 0) {
      tableContainer.replaceChildren();
      tableContainer.hidden = true;
      return;
    }

    // Format timestamp to readable date
    const formatDate = (timestamp) => {
      if (!timestamp) return 'Unknown';
      const date = new Date(Number(timestamp));
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    // Build reference interval display string
    const buildReferenceDisplay = (row) => {
      const lower = row.reference_lower;
      const upper = row.reference_upper;
      const lowerOp = row.reference_lower_operator || '>=';
      const upperOp = row.reference_upper_operator || '<=';

      if (lower !== null && lower !== undefined && upper !== null && upper !== undefined) {
        return `${lower} - ${upper}`;
      } else if (lower !== null && lower !== undefined) {
        return `${lowerOp} ${lower}`;
      } else if (upper !== null && upper !== undefined) {
        return `${upperOp} ${upper}`;
      }
      return 'Unavailable';
    };

    // Build table structure
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'parameters-table-wrapper';

    const table = document.createElement('table');
    table.className = 'parameters-table';

    // Add caption
    const caption = document.createElement('caption');
    const firstRow = rows[0];
    const unit = firstRow?.unit || '';
    caption.textContent = `${parameterName}${unit ? ' (' + unit + ')' : ''} Measurements`;
    caption.style.captionSide = 'top';
    caption.style.fontWeight = '600';
    caption.style.marginBottom = '0.5rem';
    caption.style.textAlign = 'left';
    table.appendChild(caption);

    // Table header
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col">Date</th>
        <th scope="col">Value</th>
        <th scope="col">Unit</th>
        <th scope="col">Reference Interval</th>
      </tr>
    `;
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');

      // Date cell
      const dateCell = document.createElement('td');
      dateCell.textContent = formatDate(row.t);
      tr.appendChild(dateCell);

      // Value cell (with out-of-range highlighting)
      const valueCell = document.createElement('td');
      valueCell.textContent = row.y !== null && row.y !== undefined ? String(row.y) : '--';

      // Check if value is out of range
      const isOutOfRange = row.is_out_of_range === true || row.is_value_out_of_range === true;
      if (isOutOfRange) {
        valueCell.dataset.outOfRange = 'true';
      }
      tr.appendChild(valueCell);

      // Unit cell
      const unitCell = document.createElement('td');
      unitCell.textContent = row.unit || '--';
      tr.appendChild(unitCell);

      // Reference Interval cell
      const refCell = document.createElement('td');
      refCell.textContent = buildReferenceDisplay(row);
      tr.appendChild(refCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    tableWrapper.appendChild(table);
    tableContainer.replaceChildren(tableWrapper);
    tableContainer.hidden = false;
  }

  /**
   * PRD v4.7: Initialize segment control handlers
   * Attach click and keyboard handlers for Plot/Table toggle
   * @param {HTMLElement} plotSection - The root .chat-plot-visualization element
   * @param {string} canvasId - Canvas ID for chart resize
   */
  initViewSegmentControl(plotSection, canvasId) {
    const segmentControl = plotSection.querySelector('.view-segment-control');
    if (!segmentControl) return;

    const buttons = segmentControl.querySelectorAll('.segment-button');

    // Click handlers
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const targetView = button.dataset.view;
        this.switchView(plotSection, targetView, canvasId);
      });
    });

    // Keyboard navigation (Arrow Left/Right for roving tabindex)
    segmentControl.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      const currentButton = document.activeElement;
      if (!currentButton.classList.contains('segment-button')) return;

      event.preventDefault();

      const buttonsArray = Array.from(buttons);
      const currentIndex = buttonsArray.indexOf(currentButton);
      let newIndex;

      if (event.key === 'ArrowLeft') {
        newIndex = currentIndex === 0 ? buttonsArray.length - 1 : currentIndex - 1;
      } else {
        newIndex = currentIndex === buttonsArray.length - 1 ? 0 : currentIndex + 1;
      }

      const newButton = buttonsArray[newIndex];
      const targetView = newButton.dataset.view;

      // Switch view and focus new button
      this.switchView(plotSection, targetView, canvasId);
      newButton.focus();
    });
  }

  /**
   * PRD v4.7: Switch between Plot and Table views
   * @param {HTMLElement} container - The root .chat-plot-visualization element
   * @param {string} targetView - 'plot' or 'table'
   * @param {string} canvasId - Canvas ID for chart resize
   */
  switchView(container, targetView, canvasId) {
    const segmentControl = container.querySelector('.view-segment-control');
    const buttons = container.querySelectorAll('.segment-button');
    const panels = container.querySelectorAll('.chat-view');

    // Update segment control data-active for indicator animation
    segmentControl.dataset.active = targetView;

    // Update button states
    buttons.forEach(button => {
      const isActive = button.dataset.view === targetView;
      button.classList.toggle('segment-button--active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    // Update panel visibility (CSS handles animation via visibility + opacity)
    panels.forEach(panel => {
      const isPlotPanel = panel.classList.contains('chat-view--plot');
      const isActive = (targetView === 'plot' && isPlotPanel) || (targetView === 'table' && !isPlotPanel);
      panel.classList.toggle('chat-view--active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    // If switching to plot, resize chart in next frame (ensures DOM is updated)
    if (targetView === 'plot' && canvasId) {
      requestAnimationFrame(() => {
        const chart = this.charts.get(canvasId);
        if (chart) {
          chart.resize();
        }
      });
    }
  }

  /**
   * PRD v4.7: Render table in the Table view panel
   * Uses scoped selector to target .chat-scrollable-table-container
   * @param {HTMLElement} plotSection - The root .chat-plot-visualization element
   * @param {Array} rows - Filtered dataset for selected parameter
   * @param {string} parameterName - Currently selected parameter name
   */
  renderTableInView(plotSection, rows, parameterName) {
    const tableContainer = plotSection.querySelector('.chat-scrollable-table-container');
    if (!tableContainer) return;

    // Format timestamp to readable date
    const formatDate = (timestamp) => {
      if (!timestamp) return 'Unknown';
      const date = new Date(Number(timestamp));
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    // Build reference interval display string
    const buildReferenceDisplay = (row) => {
      const lower = row.reference_lower;
      const upper = row.reference_upper;
      const lowerOp = row.reference_lower_operator || '>=';
      const upperOp = row.reference_upper_operator || '<=';

      if (lower !== null && lower !== undefined && upper !== null && upper !== undefined) {
        return `${lower} - ${upper}`;
      } else if (lower !== null && lower !== undefined) {
        return `${lowerOp} ${lower}`;
      } else if (upper !== null && upper !== undefined) {
        return `${upperOp} ${upper}`;
      }
      return 'Unavailable';
    };

    // Build table structure
    const table = document.createElement('table');
    table.className = 'parameters-table';

    // Add caption
    const caption = document.createElement('caption');
    const firstRow = rows[0];
    const unit = firstRow?.unit || '';
    const displayName = parameterName || 'Data';
    caption.textContent = `${displayName}${unit ? ' (' + unit + ')' : ''} Measurements`;
    caption.style.captionSide = 'top';
    caption.style.fontWeight = '600';
    caption.style.marginBottom = '0.5rem';
    caption.style.textAlign = 'left';
    table.appendChild(caption);

    // Table header
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col">Date</th>
        <th scope="col">Value</th>
        <th scope="col">Unit</th>
        <th scope="col">Reference Interval</th>
      </tr>
    `;
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement('tbody');

    // PRD v4.7: Handle zero data rows with placeholder
    if (!rows || rows.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'no-data-row';
      tr.innerHTML = '<td colspan="4">No data available</td>';
      tbody.appendChild(tr);
    } else {
      rows.forEach(row => {
        const tr = document.createElement('tr');

        // Date cell
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(row.t);
        tr.appendChild(dateCell);

        // Value cell (with out-of-range highlighting)
        const valueCell = document.createElement('td');
        valueCell.textContent = row.y !== null && row.y !== undefined ? String(row.y) : '--';

        // Check if value is out of range
        const isOutOfRange = row.is_out_of_range === true || row.is_value_out_of_range === true;
        if (isOutOfRange) {
          valueCell.dataset.outOfRange = 'true';
        }
        tr.appendChild(valueCell);

        // Unit cell
        const unitCell = document.createElement('td');
        unitCell.textContent = row.unit || '--';
        tr.appendChild(unitCell);

        // Reference Interval cell
        const refCell = document.createElement('td');
        refCell.textContent = buildReferenceDisplay(row);
        tr.appendChild(refCell);

        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);

    tableContainer.replaceChildren(table);
  }

  /**
   * Display plot results
   * PRD v4.7: Updated with segment control for Plot/Table view toggle
   */
  displayPlotResults(rows, plotMetadata, plotTitle) {
    // Note: Charts are destroyed via destroyAllCharts() in handlePlotResult() before this is called

    // Generate unique canvas ID to support multiple concurrent plots
    const canvasId = `resultChart-${this.plotCounter++}`;

    // PRD v4.7: Create plot visualization structure with segment control
    const plotSection = document.createElement('div');
    plotSection.className = 'chat-plot-visualization';
    plotSection.innerHTML = `
      <!-- Header with title and segment control -->
      <div class="chat-plot-header">
        <h3>${this.escapeHtml(plotTitle || 'Results')}</h3>
        <div class="view-segment-control" role="tablist" aria-label="View options" data-active="plot">
          <div class="segment-indicator"></div>
          <button class="segment-button segment-button--active" id="tab-plot-${canvasId}" data-view="plot" role="tab" aria-selected="true" aria-controls="panel-plot-${canvasId}">
            <svg class="segment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <span>Plot</span>
          </button>
          <button class="segment-button" id="tab-table-${canvasId}" data-view="table" role="tab" aria-selected="false" aria-controls="panel-table-${canvasId}" tabindex="-1">
            <svg class="segment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="3" y1="15" x2="21" y2="15"></line>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
            <span>Table</span>
          </button>
        </div>
      </div>

      <!-- Main content area: sidebar + view container -->
      <div class="chat-plot-content">
        <!-- Parameter selector (OUTSIDE view container - always visible) -->
        <div class="chat-parameter-selector-panel">
          <h4 class="chat-parameter-selector-title">Select Parameter</h4>
          <div class="chat-parameter-list">
            <!-- Dynamically populated -->
          </div>
        </div>

        <!-- View container with fixed height -->
        <div class="chat-view-container">
          <!-- Plot view (default active) -->
          <div class="chat-view chat-view--plot chat-view--active" id="panel-plot-${canvasId}" role="tabpanel" aria-labelledby="tab-plot-${canvasId}" aria-hidden="false">
            <div class="chat-plot-canvas-wrapper">
              <div class="chat-plot-toolbar">
                <span class="chat-plot-toolbar-hint">Pan and zoom to explore the data.</span>
              </div>
              <canvas id="${canvasId}" width="800" height="400"></canvas>
            </div>
          </div>

          <!-- Table view (inactive - uses CSS visibility + aria-hidden for screen readers) -->
          <div class="chat-view chat-view--table" id="panel-table-${canvasId}" role="tabpanel" aria-labelledby="tab-table-${canvasId}" aria-hidden="true">
            <div class="chat-scrollable-table-container">
              <!-- Table dynamically rendered -->
            </div>
          </div>
        </div>
      </div>
    `;
    this.resultsContainer.appendChild(plotSection);

    // Get references to dynamically created elements
    const selectorContainer = plotSection.querySelector('.chat-parameter-list');

    // Use existing plotRenderer if available
    if (window.plotRenderer && window.plotRenderer.renderPlot) {
      // Strip out-of-range flags from plot data (keep for table only)
      // This prevents red triangle markers from appearing on the plot
      const rowsForPlot = rows.map(row => {
        const { is_value_out_of_range, is_out_of_range, ...plotRow } = row;
        return plotRow;
      });

      // Show parameter selector and filter data
      const selectedParameter = this.renderParameterSelector(rowsForPlot, selectorContainer);

      // Filter to selected parameter (or use all data if no parameter_name)
      let filteredRows = rowsForPlot;
      let filteredRowsWithOutOfRange = rows; // Keep original for table
      if (selectedParameter) {
        filteredRows = rowsForPlot.filter(row => row.parameter_name === selectedParameter);
        filteredRowsWithOutOfRange = rows.filter(row => row.parameter_name === selectedParameter);
      }

      // Render plot with filtered data (without out-of-range flags)
      const chart = window.plotRenderer.renderPlot(canvasId, filteredRows, {
        title: selectedParameter || plotTitle,
        xAxisLabel: 'Date',
        yAxisLabel: 'Value',
        timeUnit: 'day'
      });

      // Track the chart instance
      this.charts.set(canvasId, chart);

      // PRD v4.7: Initialize segment control handlers
      this.initViewSegmentControl(plotSection, canvasId);

      // Attach parameter selector event listener (pass both versions and plotSection)
      this.attachParameterSelectorListener(rowsForPlot, rows, selectorContainer, canvasId, plotTitle, plotSection);

      // PRD v4.7: Pre-render table in table view for instant switching (with out-of-range flags)
      // Render table when there are rows, regardless of whether parameter_name exists
      if (filteredRowsWithOutOfRange.length > 0) {
        this.renderTableInView(plotSection, filteredRowsWithOutOfRange, selectedParameter);
      }
    } else {
      console.warn('[Chat] plotRenderer not available, showing raw data');
      this.displayTableResults(rows);
    }
  }

  /**
   * Display table results
   * PRD v7.0: i18n support
   */
  displayTableResults(rows, title) {
    const tableSection = document.createElement('div');
    tableSection.className = 'result-section';

    if (!rows || rows.length === 0) {
      const t = window.i18next?.t?.bind(window.i18next);
      const noResultsText = t ? t('chat:noResults') : 'No results found.';
      tableSection.innerHTML = `<p>${noResultsText}</p>`;
      this.resultsContainer.appendChild(tableSection);
      return;
    }

    // Use the same table structure as parameter table (PRD v2.6)
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'parameters-table-wrapper';

    const table = document.createElement('table');
    table.className = 'parameters-table';

    // Add title if provided
    if (title) {
      const caption = document.createElement('caption');
      caption.textContent = title;
      caption.style.captionSide = 'top';
      caption.style.fontWeight = '600';
      caption.style.marginBottom = '0.5rem';
      caption.style.textAlign = 'left';
      table.appendChild(caption);
    }

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col">Parameter</th>
        <th scope="col">Value</th>
        <th scope="col">Unit</th>
        <th scope="col">Reference Interval</th>
      </tr>
    `;

    const tbody = document.createElement('tbody');

    rows.forEach((entry, index) => {
      const row = document.createElement('tr');

      // Helper to build reference interval display
      const buildReferenceDisplay = () => {
        if (entry.reference_range) {
          return entry.reference_range;
        }

        const lower = entry.reference_lower;
        const upper = entry.reference_upper;
        const lowerOp = entry.reference_lower_operator || '>';
        const upperOp = entry.reference_upper_operator || '<';

        if (lower !== null && lower !== undefined && upper !== null && upper !== undefined) {
          return `${lower} - ${upper}`;
        } else if (lower !== null && lower !== undefined) {
          return `${lowerOp} ${lower}`;
        } else if (upper !== null && upper !== undefined) {
          return `${upperOp} ${upper}`;
        }
        return '--';
      };

      // Parameter name
      const paramName = entry.parameter_name || entry.analyte_name || entry.name || `Parameter ${index + 1}`;
      const nameCell = document.createElement('td');
      nameCell.textContent = paramName;
      row.appendChild(nameCell);

      // Value (handle multiple column name conventions)
      const resultValue = entry.result_value || entry.value || entry.value_num || entry.y;
      const resultCell = document.createElement('td');
      if (resultValue !== null && resultValue !== undefined) {
        if (typeof resultValue === 'number') {
          resultCell.textContent = Number.isInteger(resultValue) ? resultValue : resultValue.toFixed(2);
        } else {
          resultCell.textContent = resultValue;
        }
      } else {
        resultCell.textContent = '--';
      }

      // Highlight out-of-range
      if (entry.is_value_out_of_range === true || entry.is_out_of_range === true) {
        resultCell.dataset.outOfRange = 'true';
      }

      row.appendChild(resultCell);

      // Unit (handle multiple column name conventions from v_measurements)
      const unitCell = document.createElement('td');
      unitCell.textContent = entry.unit || entry.units || entry.unit_normalized || '--';
      row.appendChild(unitCell);

      // Reference interval
      const refCell = document.createElement('td');
      refCell.textContent = buildReferenceDisplay();
      row.appendChild(refCell);

      tbody.appendChild(row);
    });

    table.append(thead, tbody);
    tableWrapper.append(table);
    tableSection.innerHTML = '<h3>Results</h3>';
    tableSection.appendChild(tableWrapper);
    this.resultsContainer.appendChild(tableSection);
  }

  /**
   * Handle error event
   */
  handleError(data) {
    console.error('[Chat] Error event:', data);

    // PRD v4.2.4: Finalize with message_id if available
    this.finalizeAssistantMessage(data.message_id);

    // Clear all tool indicators (cleanup)
    const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
    if (indicatorsContainer) {
      indicatorsContainer.remove();
    }
    this.activeTools.clear();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'chat-message chat-message-assistant';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-assistant chat-bubble-error';
    bubble.textContent = `❌ Error: ${data.message}`;

    errorDiv.appendChild(bubble);
    this.messagesContainer.appendChild(errorDiv);

    this.scrollToBottom();

    this.isProcessing = false;
    this.syncInputState();

    // Clear chat after error
    setTimeout(() => {
      this.clearChat();
      this.showWelcomeMessage();
    }, 3000);
  }

  /**
   * Show error message
   */
  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'chat-message chat-message-system';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-error';
    bubble.textContent = message;

    errorDiv.appendChild(bubble);
    this.messagesContainer.appendChild(errorDiv);

    this.scrollToBottom();
  }

  /**
   * Show welcome message
   */
  showWelcomeMessage() {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'chat-message chat-message-assistant';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-assistant';
    bubble.textContent = 'Ask a question about your lab results (e.g., "Show my vitamin D tests")';

    welcomeDiv.appendChild(bubble);
    this.messagesContainer.appendChild(welcomeDiv);
  }

  /**
   * Clear chat messages
   */
  clearChat() {
    this.messagesContainer.innerHTML = '';
    this.messageBuffers.clear(); // PRD v4.2.4: Clear per-message buffers
    this.activeTools.clear();
  }

  /**
   * Enable input
   */
  enableInput() {
    this.inputTextarea.disabled = false;
    this.sendButton.disabled = false;
  }

  /**
   * Disable input
   */
  disableInput() {
    this.inputTextarea.disabled = true;
    this.sendButton.disabled = true;
  }

  /**
   * PRD v6.0: Centralized input state management
   * Synchronizes input/send/attach button states based on isUploading and isProcessing
   * Replaces scattered enableInput() calls to prevent race conditions
   */
  syncInputState() {
    if (this.isUploading || this.isProcessing) {
      this.disableInput();
      if (this.attachButton) {
        this.attachButton.setAttribute('disabled', 'true');
      }
    } else {
      this.enableInput();
      if (this.attachButton) {
        this.attachButton.removeAttribute('disabled');
      }
    }
  }

  /**
   * Destroy all Chart.js instances
   */
  destroyAllCharts() {
    if (window.plotRenderer) {
      for (const [canvasId, chart] of this.charts.entries()) {
        try {
          window.plotRenderer.destroyChart(chart);
        } catch (e) {
          console.warn(`[Chat] Failed to destroy chart ${canvasId}:`, e);
        }
      }
    }
    this.charts.clear();
  }

  /**
   * Scroll chat to bottom
   */
  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /**
   * Scroll to bottom only if user is already near bottom
   * This prevents forcing scroll during streaming when user is reading previous messages
   */
  scrollToBottomIfNearBottom() {
    const container = this.messagesContainer;
    const scrollThreshold = 100; // pixels from bottom
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < scrollThreshold;

    if (isNearBottom) {
      this.scrollToBottom();
    }
  }

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // PRD v6.0: Upload Functionality
  // ============================================================

  /**
   * PRD v6.0: Initialize upload UI components
   * Creates attachment button, hidden file input, and drag-drop handlers
   */
  initUploadUI() {
    // Get drop overlay reference
    this.dropOverlay = document.getElementById('chat-drop-overlay');

    // Create attachment button
    this.attachButton = document.createElement('button');
    this.attachButton.className = 'chat-attach-btn';
    this.attachButton.type = 'button';
    this.attachButton.setAttribute('aria-label', 'Attach files');
    this.attachButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
      </svg>
    `;

    // Create hidden file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.className = 'chat-file-input';
    this.fileInput.accept = '.pdf,.png,.jpg,.jpeg,.heic';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';

    // Insert attachment button before send button
    const inputWrapper = this.chatContainer.querySelector('.chat-input-wrapper');
    if (inputWrapper && this.sendButton) {
      inputWrapper.insertBefore(this.attachButton, this.inputTextarea);
      inputWrapper.appendChild(this.fileInput);
    }

    // Attachment button click → trigger file input
    this.attachButton.addEventListener('click', () => {
      if (!this.attachButton.hasAttribute('disabled')) {
        this.fileInput.click();
      }
    });

    // File input change handler
    this.fileInput.addEventListener('change', (event) => {
      if (event.target.files && event.target.files.length > 0) {
        this.handleFileSelection(Array.from(event.target.files));
        // Reset input to allow selecting same file again
        this.fileInput.value = '';
      }
    });

    // Setup drag-and-drop
    this.setupDragDrop();
  }

  /**
   * PRD v6.0: Setup drag-and-drop handlers on chat container
   */
  setupDragDrop() {
    const chatSection = document.getElementById('section-assistant');
    if (!chatSection) return;

    let dragCounter = 0;

    chatSection.addEventListener('dragenter', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter++;

      if (dragCounter === 1 && !this.isUploading && !this.isProcessing) {
        this.dropOverlay?.removeAttribute('hidden');
      }
    });

    chatSection.addEventListener('dragleave', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter--;

      if (dragCounter === 0) {
        this.dropOverlay?.setAttribute('hidden', '');
      }
    });

    chatSection.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    chatSection.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter = 0;
      this.dropOverlay?.setAttribute('hidden', '');

      if (this.isUploading || this.isProcessing) {
        return;
      }

      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0) {
        this.handleFileSelection(files);
      }
    });
  }

  /**
   * PRD v6.0: Handle file selection from input or drop
   * Validates files and starts batch upload
   * @param {File[]} files - Selected files
   */
  async handleFileSelection(files) {
    console.log('[Chat Upload] Files selected:', files.length);

    // Validate files
    const validation = this.validateFiles(files);
    if (!validation.valid) {
      this.showToast(validation.error, 'error');
      return;
    }

    // Set upload state
    this.isUploading = true;
    this.isCancelled = false;
    this.syncInputState();

    try {
      // Create FormData with files
      const formData = new FormData();
      files.forEach(file => {
        formData.append('analysisFile', file);
      });

      // Add fallbackPatientId if we have a selected patient
      if (this.selectedPatientId) {
        formData.append('fallbackPatientId', this.selectedPatientId);
      }

      // Submit batch upload
      const response = await fetch('/api/analyze-labs/batch', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const { batch_id: batchId, jobs } = await response.json();
      this.currentBatchId = batchId;

      // Build job order map for file ordering
      this.jobOrderMap.clear();
      jobs.forEach((job, index) => {
        this.jobOrderMap.set(job.job_id, index);
      });

      console.log('[Chat Upload] Batch created:', batchId, 'Jobs:', jobs.length);

      // Create upload card in chat
      this.createUploadCard(jobs);

      // Start polling for status
      this.startBatchPolling(batchId);

    } catch (error) {
      console.error('[Chat Upload] Upload failed:', error);
      this.showToast(`Upload failed: ${error.message}`, 'error');
      this.isUploading = false;
      this.currentBatchId = null;
      this.syncInputState();
    }
  }

  /**
   * PRD v6.0: Validate files before upload
   * Reuses validation rules from unified-upload.js
   * @param {File[]} files - Files to validate
   * @returns {{ valid: boolean, error?: string }}
   */
  validateFiles(files) {
    // Constants matching unified-upload.js
    const MAX_FILES = 20;
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
    const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total
    const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic'];
    const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.heic'];

    if (files.length === 0) {
      return { valid: false, error: 'No files selected' };
    }

    if (files.length > MAX_FILES) {
      return { valid: false, error: `Maximum ${MAX_FILES} files allowed per batch` };
    }

    let totalSize = 0;
    for (const file of files) {
      // Check file type
      const extension = '.' + file.name.split('.').pop().toLowerCase();
      const isValidType = ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(extension);
      if (!isValidType) {
        return { valid: false, error: `Invalid file type: ${file.name}. Allowed: PDF, PNG, JPEG, HEIC` };
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        return { valid: false, error: `File too large: ${file.name}. Maximum 10MB per file` };
      }

      totalSize += file.size;
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      return { valid: false, error: 'Total batch size exceeds 100MB limit' };
    }

    return { valid: true };
  }

  /**
   * PRD v6.0: Create upload card in chat messages
   * Shows grouped upload progress for batch
   * @param {Array} jobs - Initial job list from batch creation
   */
  createUploadCard(jobs) {
    // Remove any existing upload card first
    const existingCard = this.messagesContainer.querySelector('.chat-bubble-upload');
    if (existingCard) {
      existingCard.closest('.chat-message').remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message chat-message-user';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-upload';
    bubble.innerHTML = `
      <div class="upload-card">
        <div class="upload-card-header">
          <span class="upload-title">Uploading ${jobs.length} file${jobs.length > 1 ? 's' : ''}...</span>
          <button class="upload-cancel-btn" type="button" aria-label="Cancel upload">✕</button>
        </div>
        <div class="upload-file-list">
          ${jobs.map((job, index) => `
            <div class="upload-file-row" data-job-id="${this.escapeHtml(job.job_id || '')}">
              <span class="upload-filename">${this.escapeHtml(job.filename || `File ${index + 1}`)}</span>
              <span class="upload-file-status upload-file-status--pending">Queued</span>
            </div>
          `).join('')}
        </div>
        <div class="upload-card-progress">
          <div class="upload-progress-bar">
            <div class="upload-progress-fill" style="width: 0%"></div>
          </div>
        </div>
      </div>
    `;

    // Cancel button handler
    const cancelBtn = bubble.querySelector('.upload-cancel-btn');
    cancelBtn.addEventListener('click', () => this.cancelUpload());

    messageDiv.appendChild(bubble);
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  /**
   * PRD v6.0: Update upload card with job status
   * @param {Array} jobs - Current job statuses from polling
   */
  updateUploadCard(jobs) {
    const uploadCard = this.messagesContainer.querySelector('.upload-card');
    if (!uploadCard) return;

    // Update each file row status
    jobs.forEach(job => {
      const row = uploadCard.querySelector(`[data-job-id="${job.job_id}"]`);
      if (!row) return;

      const statusEl = row.querySelector('.upload-file-status');
      if (!statusEl) return;

      // Clear existing status classes
      statusEl.className = 'upload-file-status';

      switch (job.status) {
        case 'pending':
        case 'queued':
          statusEl.classList.add('upload-file-status--pending');
          statusEl.textContent = 'Queued';
          break;
        case 'processing':
          statusEl.classList.add('upload-file-status--processing');
          statusEl.textContent = 'Processing...';
          break;
        case 'completed':
          statusEl.classList.add('upload-file-status--completed');
          statusEl.textContent = '✓ Done';
          break;
        case 'failed':
          statusEl.classList.add('upload-file-status--failed');
          statusEl.textContent = '✕ Failed';
          break;
        default:
          statusEl.textContent = job.status;
      }
    });

    // Update progress bar
    const completedCount = jobs.filter(j => j.status === 'completed' || j.status === 'failed').length;
    const progressPercent = Math.round((completedCount / jobs.length) * 100);
    const progressFill = uploadCard.querySelector('.upload-progress-fill');
    if (progressFill) {
      progressFill.style.width = `${progressPercent}%`;
    }

    // Update title
    const title = uploadCard.querySelector('.upload-title');
    if (title) {
      const processingCount = jobs.filter(j => j.status === 'processing').length;
      if (processingCount > 0) {
        title.textContent = `Processing ${processingCount} of ${jobs.length} file${jobs.length > 1 ? 's' : ''}...`;
      } else if (completedCount === jobs.length) {
        title.textContent = `${jobs.length} file${jobs.length > 1 ? 's' : ''} processed`;
      }
    }
  }

  /**
   * PRD v6.0: Start polling for batch status
   * @param {string} batchId - Batch ID to poll
   */
  startBatchPolling(batchId) {
    // Clear any existing poll timer
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    const poll = async () => {
      if (this.isCancelled) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        return;
      }

      try {
        const response = await fetch(`/api/analyze-labs/batches/${batchId}`, {
          credentials: 'include'
        });

        // Re-check cancellation after fetch - user may have cancelled during network round-trip
        if (this.isCancelled) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to get batch status');
        }

        const { jobs, allComplete } = await response.json();

        // Update upload card UI
        this.updateUploadCard(jobs);

        if (allComplete) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
          this.handleBatchComplete(jobs);
        }
      } catch (error) {
        console.error('[Chat Upload] Poll error:', error);
        // Continue polling unless cancelled
      }
    };

    // Initial poll immediately
    poll();

    // Then poll every 2 seconds
    this.pollTimer = setInterval(poll, 2000);
  }

  /**
   * PRD v6.0: Handle batch completion
   * Evaluates primary patient and triggers LLM analysis
   * @param {Array} jobs - Completed job statuses
   */
  async handleBatchComplete(jobs) {
    // Detailed debug logging for batch completion
    console.log('[Chat Upload] Batch complete - full job details:', {
      total_jobs: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      with_report_id: jobs.filter(j => j.report_id).length,
      with_patient_id: jobs.filter(j => j.patient_id).length,
      jobs: jobs.map(j => ({
        job_id: j.job_id,
        filename: j.filename,
        status: j.status,
        report_id: j.report_id,
        patient_id: j.patient_id,
        patient_name: j.patient_name,
        parameter_count: j.parameter_count,
        error: j.error
      }))
    });

    // Check if all failed
    const successfulJobs = jobs.filter(j => j.status === 'completed');
    if (successfulJobs.length === 0) {
      this.showToast('All files failed to process', 'error');
      this.removeUploadCardAfterDelay();
      this.isUploading = false;
      this.currentBatchId = null;
      this.syncInputState();
      return;
    }

    // Transform upload card to completion state
    this.transformUploadCardToComplete(jobs);

    // Determine primary patient from jobs
    const primaryPatient = this.determinePrimaryPatient(jobs);

    // Build upload context for LLM
    const primaryPatientId = primaryPatient?.patientId || this.selectedPatientId;
    const uploadContext = this.buildUploadContext(jobs, primaryPatientId);

    // Check if we need to switch patients
    if (primaryPatient && primaryPatient.patientId !== this.selectedPatientId) {
      // Need to switch patient context
      await this.handlePatientSwitchFromUpload(
        primaryPatient.patientId,
        primaryPatient.patientName,
        primaryPatient.isNew,
        uploadContext
      );
    } else {
      // Same patient - just trigger LLM analysis
      this.isUploading = false;
      this.syncInputState();
      await this.sendUploadContextToLLM(uploadContext);
    }

    this.currentBatchId = null;
  }

  /**
   * PRD v6.0: Transform upload card to completion state
   * @param {Array} jobs - Completed job statuses
   */
  transformUploadCardToComplete(jobs) {
    const bubble = this.messagesContainer.querySelector('.chat-bubble-upload');
    if (!bubble) return;

    // Add completion class
    bubble.classList.add('chat-bubble-upload-complete');

    // Remove cancel button
    const cancelBtn = bubble.querySelector('.upload-cancel-btn');
    if (cancelBtn) {
      cancelBtn.remove();
    }

    // Update title with done badge
    const title = bubble.querySelector('.upload-title');
    if (title) {
      const successCount = jobs.filter(j => j.status === 'completed').length;
      title.innerHTML = `<span class="upload-done-badge">✓</span> ${successCount} file${successCount !== 1 ? 's' : ''} uploaded`;
    }

    // Remove progress bar
    const progressContainer = bubble.querySelector('.upload-card-progress');
    if (progressContainer) {
      progressContainer.remove();
    }

    // Add View button to each completed file row
    const uploadCard = bubble.querySelector('.upload-card');
    if (!uploadCard) return;

    jobs.forEach(job => {
      const row = uploadCard.querySelector(`[data-job-id="${job.job_id}"]`);
      if (!row) return;

      // Add View button for completed jobs with valid report_id (UUID format)
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (job.status === 'completed' && job.report_id && uuidPattern.test(job.report_id)) {
        // Check if View button already exists
        if (!row.querySelector('.upload-view-btn')) {
          const viewBtn = document.createElement('a');
          viewBtn.href = `/?reportId=${job.report_id}`;
          viewBtn.className = 'upload-view-btn';
          viewBtn.target = '_blank';
          viewBtn.textContent = 'View';
          row.appendChild(viewBtn);
        }
      }
    });
  }

  /**
   * PRD v6.0: Determine primary patient from completed jobs
   * Uses file order to select first job with valid patient_name
   * @param {Array} jobs - Completed job statuses
   * @returns {{ patientId: string, patientName: string, isNew: boolean } | null}
   */
  determinePrimaryPatient(jobs) {
    // Sort by original file order using jobOrderMap
    const sorted = [...jobs].sort((a, b) =>
      (this.jobOrderMap.get(a.job_id) ?? Infinity) -
      (this.jobOrderMap.get(b.job_id) ?? Infinity)
    );

    // First completed job with non-null patient_name
    for (const job of sorted) {
      if (job.status === 'completed' && job.patient_name) {
        return {
          patientId: job.patient_id,
          patientName: job.patient_name,
          isNew: job.is_new_patient
        };
      }
    }

    // No patient found in any job - keep current patient
    return null;
  }

  /**
   * PRD v6.0: Build upload context for LLM system prompt
   * @param {Array} jobs - Completed job statuses
   * @param {string} primaryPatientId - Patient ID for context
   * @returns {object} Upload context object
   */
  buildUploadContext(jobs, primaryPatientId) {
    // Filter to successful jobs for the primary patient
    // FIX: Fall back to all completed jobs when primaryPatientId is null/undefined
    // (handles edge case where OCR misses patient_name and no patient preselected)
    const patientJobs = jobs
      .filter(j => j.status === 'completed' && (!primaryPatientId || j.patient_id === primaryPatientId))
      .sort((a, b) => (this.jobOrderMap.get(a.job_id) ?? 0) - (this.jobOrderMap.get(b.job_id) ?? 0));

    // Debug logging for context building
    console.log('[Chat Upload] buildUploadContext:', {
      primaryPatientId,
      input_jobs: jobs.length,
      completed_jobs: jobs.filter(j => j.status === 'completed').length,
      matched_patient_jobs: patientJobs.length,
      filtered_out: jobs.filter(j => j.status === 'completed' && j.patient_id !== primaryPatientId).map(j => ({
        job_id: j.job_id,
        patient_id: j.patient_id,
        filename: j.filename
      }))
    });

    // Get patient name from first job or fallback to selected patient display name
    const patientName = patientJobs.find(j => j.patient_name)?.patient_name
      || this.getSelectedPatientDisplayName();

    return {
      filenames: patientJobs.map(j => j.filename || 'Unknown file'),
      patientName,
      totalParameters: patientJobs.reduce((sum, j) => sum + (j.parameter_count || 0), 0),
      reportDates: patientJobs.map(j => j.test_date || null),
      reportIds: patientJobs.map(j => j.report_id).filter(Boolean)  // PRD v6.0: For lab data fetch
    };
  }

  /**
   * PRD v6.0: Get display name for currently selected patient
   * @returns {string} Patient display name or 'Patient'
   */
  getSelectedPatientDisplayName() {
    const patient = this.patients.find(p => p.id === this.selectedPatientId);
    return patient?.display_name || patient?.full_name || 'Patient';
  }

  /**
   * PRD v6.0: Handle patient switch from upload
   * Closes current session, creates new one for new patient, triggers LLM
   * @param {string} primaryPatientId - New patient ID
   * @param {string} primaryPatientName - New patient display name
   * @param {boolean} isNewPatient - Whether this is a newly created patient
   * @param {object} uploadContext - Upload context for LLM
   */
  async handlePatientSwitchFromUpload(primaryPatientId, primaryPatientName, isNewPatient, uploadContext) {
    console.log('[Chat Upload] Switching patient:', {
      from: this.selectedPatientId,
      to: primaryPatientId,
      isNew: isNewPatient
    });

    // 1. Unlock chips
    this.chipsLocked = false;

    // 2. Close SSE
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // FIX: Reset session_start flag for new session
    this._sessionStartReceived = false;

    // 3. Delete current session (fire-and-forget)
    if (this.sessionId) {
      fetch(`/api/chat/sessions/${this.sessionId}`, { method: 'DELETE' }).catch(() => {});
      this.sessionId = null;
    }

    // 4. Clear chat messages (keep upload card)
    this.clearChatMessagesKeepingUpload();

    // 5. Update selection
    this.selectedPatientId = primaryPatientId;

    // 6. Re-fetch patients (new patient may exist)
    await this.fetchPatientsAndRender();

    // 7. Create new session
    try {
      const response = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedPatientId: primaryPatientId })
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const { sessionId } = await response.json();
      this.sessionId = sessionId;

      // 8. Connect SSE
      this.connectSSE(sessionId);

      // 9. Wait for session_start event
      await this.waitForSessionStart();

      // 10. Show toast
      this.showToast(
        isNewPatient
          ? `Created profile for: ${primaryPatientName}`
          : `Switched to: ${primaryPatientName}`,
        'success'
      );

      // 11. Trigger LLM with upload context
      this.isUploading = false;
      this.syncInputState();
      await this.sendUploadContextToLLM(uploadContext);

    } catch (error) {
      console.error('[Chat Upload] Patient switch failed:', error);
      this.showToast('Failed to switch patient context', 'error');
      this.isUploading = false;
      this.syncInputState();
    }
  }

  /**
   * PRD v6.0: Clear chat messages but keep upload card
   */
  clearChatMessagesKeepingUpload() {
    const uploadMessage = this.messagesContainer.querySelector('.chat-bubble-upload')?.closest('.chat-message');
    const emptyState = this.messagesContainer.querySelector('.chat-empty-state');

    this.messagesContainer.innerHTML = '';

    if (uploadMessage) {
      this.messagesContainer.appendChild(uploadMessage);
    }

    // Also clear buffers
    this.messageBuffers.clear();
    this.activeTools.clear();
  }

  /**
   * PRD v6.0: Fetch patients and re-render chips
   */
  async fetchPatientsAndRender() {
    try {
      const response = await fetch(window.getReportsEndpoint('/patients') + '?sort=recent');
      if (response.ok) {
        const data = await response.json();
        this.patients = data.patients || [];
        this.renderPatientChips();
      }
    } catch (error) {
      console.warn('[Chat Upload] Failed to refresh patients:', error);
    }
  }

  /**
   * PRD v6.0: Wait for session_start SSE event
   * Returns a promise that resolves when session_start is received
   * FIX: Resolves immediately if session_start already arrived (race condition)
   * @returns {Promise<void>}
   */
  waitForSessionStart() {
    // FIX: If session_start already arrived before this was called, resolve immediately
    if (this._sessionStartReceived) {
      console.log('[Chat Upload] session_start already received, resolving immediately');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      // Store timeout ID so it can be cleared when resolved early
      const timeoutId = setTimeout(() => {
        if (this._onSessionStartResolve) {
          console.warn('[Chat Upload] session_start timeout, proceeding anyway');
          this._onSessionStartResolve = null;
          resolve();
        }
      }, 10000);

      this._onSessionStartResolve = () => {
        clearTimeout(timeoutId);
        resolve();
      };
    });
  }

  /**
   * PRD v6.0: Send upload context to LLM
   * Triggers the assistant to analyze the uploaded files
   * @param {object} uploadContext - Upload context object
   */
  async sendUploadContextToLLM(uploadContext) {
    if (!this.sessionId) {
      console.error('[Chat Upload] No session for LLM call');
      return;
    }

    // Set processing state
    this.isProcessing = true;
    this.syncInputState();

    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionId: this.sessionId,
          message: '', // Empty message - uploadContext provides context
          uploadContext
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send upload context');
      }

      console.log('[Chat Upload] Upload context sent to LLM');
      // Response will come via SSE

    } catch (error) {
      console.error('[Chat Upload] Failed to send upload context:', error);
      this.showToast('Failed to analyze uploaded files', 'error');
      this.isProcessing = false;
      this.syncInputState();
    }
  }

  /**
   * PRD v6.0: Cancel upload in progress
   */
  cancelUpload() {
    console.log('[Chat Upload] Cancelling upload');

    this.isCancelled = true;

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Remove upload card
    const uploadMessage = this.messagesContainer.querySelector('.chat-bubble-upload')?.closest('.chat-message');
    if (uploadMessage) {
      uploadMessage.remove();
    }

    // Reset state
    this.isUploading = false;
    this.currentBatchId = null;
    this.jobOrderMap.clear();
    this.syncInputState();

    this.showToast('Upload cancelled', 'info');
  }

  /**
   * PRD v6.0: Remove upload card after delay (for error cases)
   */
  removeUploadCardAfterDelay() {
    setTimeout(() => {
      const uploadMessage = this.messagesContainer.querySelector('.chat-bubble-upload')?.closest('.chat-message');
      if (uploadMessage) {
        uploadMessage.remove();
      }
    }, 5000);
  }

  /**
   * PRD v6.0: Show toast notification
   * @param {string} message - Toast message
   * @param {string} type - 'success' | 'error' | 'info'
   * @param {number} duration - Duration in ms (default 3000)
   */
  showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `chat-toast chat-toast--${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('chat-toast--visible');
    });

    // Remove after duration
    setTimeout(() => {
      toast.classList.remove('chat-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    // FIX: Clear upload polling timer to prevent memory leak and stray requests
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.sendButton) {
      this.sendButton.removeEventListener('click', this.handleSendMessage);
    }

    if (this.inputTextarea) {
      this.inputTextarea.removeEventListener('keydown', this.handleKeyPress);
    }
  }
}

// Export for use in app.js
window.ConversationalSQLChat = ConversationalSQLChat;
