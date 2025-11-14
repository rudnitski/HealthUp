// public/js/chat.js
// Conversational SQL Assistant - Chat UI Component
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md

class ConversationalSQLChat {
  constructor() {
    this.sessionId = null;
    this.eventSource = null;
    this.isProcessing = false;
    this.currentAssistantMessage = '';
    this.activeTools = new Set(); // Track active tool executions

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

      case 'text':
        this.appendAssistantText(data.content);
        break;

      case 'tool_start':
        this.showToolIndicator(data.tool, data.params);
        break;

      case 'tool_complete':
        this.hideToolIndicator(data.tool);
        break;

      case 'message_complete':
        this.finalizeAssistantMessage();
        this.enableInput();
        this.isProcessing = false;
        break;

      case 'final_result':
        this.handleFinalResult(data);
        break;

      case 'error':
        this.handleError(data);
        break;

      case 'done':
        console.log('[Chat] Stream done');
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
   * Append text to current assistant message (streaming)
   */
  appendAssistantText(text) {
    this.currentAssistantMessage += text;

    // Find or create assistant message element
    let assistantMessageEl = this.messagesContainer.querySelector('.chat-message-assistant:last-child .chat-bubble');

    if (!assistantMessageEl) {
      // Create new assistant message
      const messageDiv = document.createElement('div');
      messageDiv.className = 'chat-message chat-message-assistant';

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble-assistant';

      messageDiv.appendChild(bubble);
      this.messagesContainer.appendChild(messageDiv);

      assistantMessageEl = bubble;
    }

    // Update content with streaming cursor
    assistantMessageEl.innerHTML = this.escapeHtml(this.currentAssistantMessage) + '<span class="streaming-cursor">|</span>';

    // Scroll to bottom
    this.scrollToBottom();
  }

  /**
   * Finalize assistant message (remove cursor)
   */
  finalizeAssistantMessage() {
    const assistantMessageEl = this.messagesContainer.querySelector('.chat-message-assistant:last-child .chat-bubble');

    if (assistantMessageEl) {
      assistantMessageEl.innerHTML = this.escapeHtml(this.currentAssistantMessage);
    }

    this.currentAssistantMessage = '';
  }

  /**
   * Show tool execution indicator
   */
  showToolIndicator(toolName, params) {
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
   * Get human-readable tool name
   */
  getToolDisplayName(toolName) {
    const displayNames = {
      'fuzzy_search_parameter_names': 'Searching parameters...',
      'fuzzy_search_analyte_names': 'Searching analytes...',
      'execute_exploratory_sql': 'Querying database...',
      'generate_final_query': 'Generating query...'
    };

    return displayNames[toolName] || toolName;
  }

  /**
   * Handle final query result
   */
  handleFinalResult(data) {
    console.log('[Chat] Final result received:', data);

    const { sql, query_type, rows, plot_metadata, plot_title } = data;

    // Finalize assistant message if any
    this.finalizeAssistantMessage();

    // Add success message to chat
    const successDiv = document.createElement('div');
    successDiv.className = 'chat-message chat-message-assistant';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-assistant chat-bubble-success';
    bubble.textContent = '✅ Here are your results:';

    successDiv.appendChild(bubble);
    this.messagesContainer.appendChild(successDiv);

    // Display results in results container
    this.displayResults(sql, query_type, rows, plot_metadata, plot_title);

    // Clear chat after results shown
    setTimeout(() => {
      this.clearChat();
      this.showWelcomeMessage();
    }, 500);

    this.isProcessing = false;
  }

  /**
   * Display query results
   */
  displayResults(sql, queryType, rows, plotMetadata, plotTitle) {
    // Clear previous results
    this.resultsContainer.innerHTML = '';

    // Show results container
    this.resultsContainer.style.display = 'block';

    // Add SQL query display
    const sqlSection = document.createElement('div');
    sqlSection.className = 'result-section';
    sqlSection.innerHTML = `
      <h3>Generated SQL Query</h3>
      <pre class="sql-display"><code>${this.escapeHtml(sql)}</code></pre>
    `;
    this.resultsContainer.appendChild(sqlSection);

    // Display results based on query type
    if (queryType === 'plot_query') {
      this.displayPlotResults(rows, plotMetadata, plotTitle);
    } else {
      this.displayTableResults(rows);
    }

    // Scroll to results
    this.resultsContainer.scrollIntoView({ behavior: 'smooth' });
  }

  /**
   * Display plot results
   */
  displayPlotResults(rows, plotMetadata, plotTitle) {
    const plotSection = document.createElement('div');
    plotSection.className = 'result-section';
    plotSection.innerHTML = `
      <h3>${this.escapeHtml(plotTitle || 'Results')}</h3>
      <canvas id="resultChart" width="800" height="400"></canvas>
    `;
    this.resultsContainer.appendChild(plotSection);

    // Use existing plotRenderer if available
    if (window.plotRenderer && window.plotRenderer.render) {
      const canvas = document.getElementById('resultChart');
      window.plotRenderer.render(canvas, rows, plotMetadata);
    } else {
      console.warn('[Chat] plotRenderer not available, showing raw data');
      this.displayTableResults(rows);
    }
  }

  /**
   * Display table results
   */
  displayTableResults(rows) {
    const tableSection = document.createElement('div');
    tableSection.className = 'result-section';

    if (!rows || rows.length === 0) {
      tableSection.innerHTML = '<p>No results found.</p>';
      this.resultsContainer.appendChild(tableSection);
      return;
    }

    // Build table
    const table = document.createElement('table');
    table.className = 'results-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    Object.keys(rows[0]).forEach(key => {
      const th = document.createElement('th');
      th.textContent = key;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      Object.values(row).forEach(value => {
        const td = document.createElement('td');
        td.textContent = value !== null && value !== undefined ? value : '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    tableSection.innerHTML = '<h3>Results</h3>';
    tableSection.appendChild(table);
    this.resultsContainer.appendChild(tableSection);
  }

  /**
   * Handle error event
   */
  handleError(data) {
    console.error('[Chat] Error event:', data);

    this.finalizeAssistantMessage();

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
    this.currentAssistantMessage = '';
    this.activeTools.clear();
  }

  /**
   * Enable input
   */
  enableInput() {
    this.inputTextarea.disabled = false;
    this.sendButton.disabled = false;
    this.inputTextarea.focus();
  }

  /**
   * Disable input
   */
  disableInput() {
    this.inputTextarea.disabled = true;
    this.sendButton.disabled = true;
  }

  /**
   * Scroll chat to bottom
   */
  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
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
