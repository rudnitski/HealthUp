// public/js/chat.js
// Conversational SQL Assistant - Chat UI Component
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md

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

    // DOM elements (will be set when UI is initialized)
    this.chatContainer = null;
    this.messagesContainer = null;
    this.inputTextarea = null;
    this.sendButton = null;
    this.resultsContainer = null;

    // Bind methods
    this.handleSendMessage = this.handleSendMessage.bind(this);
    this.handleKeyPress = this.handleKeyPress.bind(this);
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

    // Attach event listeners
    this.sendButton.addEventListener('click', this.handleSendMessage);
    this.inputTextarea.addEventListener('keydown', this.handleKeyPress);

    // Connect to SSE stream
    this.connectSSE();
  }

  /**
   * Connect to SSE stream and create session
   */
  connectSSE() {
    console.log('[Chat] Connecting to SSE stream...');

    // Close existing connection if any
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource('/api/chat/stream');

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
        this.enableInput();
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
        this.enableInput();
        this.isProcessing = false;
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
        this.showStatusIndicator(data.status, data.message);
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
      this.enableInput();
      this.isProcessing = false;
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
    indicator.innerHTML = `<span class="tool-spinner">🔄</span> ${this.getToolDisplayName(toolName)}`;

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
    indicator.innerHTML = `<span class="tool-spinner">🔄</span> ${message}`;

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
   */
  getToolDisplayName(toolName) {
    const displayNames = {
      'fuzzy_search_parameter_names': 'Searching parameters...',
      'fuzzy_search_analyte_names': 'Searching lab tests...',
      'execute_exploratory_sql': 'Exploring database...',
      'show_plot': 'Validating and fetching data...',
      'show_table': 'Validating and fetching data...'
    };

    return displayNames[toolName] || toolName;
  }

  /**
   * Handle plot result (v3.3)
   */
  handlePlotResult(data) {
    console.log('[Chat] Plot result received:', data);

    const { plot_title, rows, replace_previous, message_id } = data;

    // Finalize assistant message if any (PRD v4.2.4: use message_id)
    this.finalizeAssistantMessage(message_id);

    // Clear all tool indicators (cleanup)
    const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
    if (indicatorsContainer) {
      indicatorsContainer.remove();
    }
    this.activeTools.clear();

    // Clear or append based on replace_previous
    if (replace_previous) {
      // CRITICAL: Properly destroy ALL charts before clearing DOM
      this.destroyAllCharts();
      this.resultsContainer.innerHTML = '';
    }

    // Show results container
    this.resultsContainer.style.display = 'block';

    // Display plot
    this.displayPlotResults(rows, null, plot_title);

    // Scroll to results
    this.resultsContainer.scrollIntoView({ behavior: 'smooth' });

    // Continue conversation - don't end processing
    this.enableInput();
    this.isProcessing = false; // CRITICAL: Reset processing flag to allow follow-up questions
  }

  /**
   * Handle table result (v3.3)
   */
  handleTableResult(data) {
    console.log('[Chat] Table result received:', data);

    const { table_title, rows, replace_previous, message_id } = data;

    // Finalize assistant message if any (PRD v4.2.4: use message_id)
    this.finalizeAssistantMessage(message_id);

    // Clear all tool indicators (cleanup)
    const indicatorsContainer = this.messagesContainer.querySelector('.tool-indicators');
    if (indicatorsContainer) {
      indicatorsContainer.remove();
    }
    this.activeTools.clear();

    // Clear or append based on replace_previous
    if (replace_previous) {
      this.resultsContainer.innerHTML = '';
    }

    // Show results container
    this.resultsContainer.style.display = 'block';

    // Display table
    this.displayTableResults(rows, table_title);

    // Scroll to results
    this.resultsContainer.scrollIntoView({ behavior: 'smooth' });

    // Continue conversation - don't end processing
    this.enableInput();
    this.isProcessing = false; // CRITICAL: Reset processing flag to allow follow-up questions
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
   * @param {Array} allRowsForPlot - Full dataset without out-of-range flags (for plot)
   * @param {Array} allRowsOriginal - Full dataset with out-of-range flags (for table)
   * @param {HTMLElement} container - Parameter selector container
   * @param {string} canvasId - Canvas ID for plot
   * @param {string} plotTitle - Base plot title
   */
  attachParameterSelectorListener(allRowsForPlot, allRowsOriginal, container, canvasId, plotTitle) {
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

        // Update parameter table (with out-of-range flags for red borders)
        this.renderParameterTable(filteredRowsOriginal, selectedParameter);
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
   * Display plot results
   */
  displayPlotResults(rows, plotMetadata, plotTitle) {
    // Note: Charts are destroyed via destroyAllCharts() in handlePlotResult() before this is called

    // Generate unique canvas ID to support multiple concurrent plots
    const canvasId = `resultChart-${this.plotCounter++}`;

    // Create plot visualization structure with parameter selector
    const plotSection = document.createElement('div');
    plotSection.className = 'chat-plot-visualization';
    plotSection.innerHTML = `
      <h3>${this.escapeHtml(plotTitle || 'Results')}</h3>
      <div class="chat-plot-container">
        <!-- Left panel: Parameter selector -->
        <div class="chat-parameter-selector-panel">
          <h4 class="chat-parameter-selector-title">Select Parameter</h4>
          <div class="chat-parameter-list">
            <!-- Dynamically populated -->
          </div>
        </div>

        <!-- Right panel: Plot -->
        <div class="chat-plot-canvas-wrapper">
          <div class="chat-plot-toolbar">
            <span class="chat-plot-toolbar-hint">Pan and zoom to explore the data.</span>
          </div>
          <canvas id="${canvasId}" width="800" height="400"></canvas>
        </div>
      </div>

      <!-- Parameter table below plot -->
      <div class="chat-parameter-table-container">
        <!-- Table dynamically rendered -->
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

      // Attach parameter selector event listener (pass both versions)
      this.attachParameterSelectorListener(rowsForPlot, rows, selectorContainer, canvasId, plotTitle);

      // Render parameter table for initial load (with out-of-range flags)
      if (selectedParameter && filteredRowsWithOutOfRange.length > 0) {
        this.renderParameterTable(filteredRowsWithOutOfRange, selectedParameter);
      }
    } else {
      console.warn('[Chat] plotRenderer not available, showing raw data');
      this.displayTableResults(rows);
    }
  }

  /**
   * Display table results
   */
  displayTableResults(rows, title) {
    const tableSection = document.createElement('div');
    tableSection.className = 'result-section';

    if (!rows || rows.length === 0) {
      tableSection.innerHTML = '<p>No results found.</p>';
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

      // Value
      const resultValue = entry.result_value || entry.value || entry.y;
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

      // Unit
      const unitCell = document.createElement('td');
      unitCell.textContent = entry.unit || '--';
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

    this.enableInput();
    this.isProcessing = false;

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

  /**
   * Cleanup on destroy
   */
  destroy() {
    if (this.eventSource) {
      this.eventSource.close();
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
