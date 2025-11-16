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
    this.currentChart = null; // Track current chart instance for cleanup
    this.parameterSelectorChangeHandler = null; // Track parameter selector listener

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

      case 'plot_result':
        this.handlePlotResult(data);
        break;

      case 'table_result':
        this.handleTableResult(data);
        break;

      case 'error':
        this.handleError(data);
        break;

      case 'done':
        console.log('[Chat] Stream done');
        this.enableInput();
        this.isProcessing = false;
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
      'show_plot': 'Generating plot...',
      'show_table': 'Generating table...'
    };

    return displayNames[toolName] || toolName;
  }

  /**
   * Handle plot result (v3.3)
   */
  handlePlotResult(data) {
    console.log('[Chat] Plot result received:', data);

    const { plot_title, rows, replace_previous } = data;

    // Finalize assistant message if any
    this.finalizeAssistantMessage();

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

    // Display plot
    this.displayPlotResults(rows, null, plot_title);

    // Scroll to results
    this.resultsContainer.scrollIntoView({ behavior: 'smooth' });

    // Continue conversation - don't end processing
    this.enableInput();
  }

  /**
   * Handle table result (v3.3)
   */
  handleTableResult(data) {
    console.log('[Chat] Table result received:', data);

    const { table_title, rows, replace_previous } = data;

    // Finalize assistant message if any
    this.finalizeAssistantMessage();

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

    // If only one parameter, hide selector
    if (parameters.length === 1) {
      container.style.display = 'none';
      return parameters[0];
    }

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

        // Destroy existing chart
        if (this.currentChart && window.plotRenderer) {
          window.plotRenderer.destroyChart(this.currentChart);
        }

        // Re-render with filtered data (without out-of-range flags)
        this.currentChart = window.plotRenderer.renderPlot(canvasId, filteredRowsForPlot, {
          title: selectedParameter || plotTitle,
          xAxisLabel: 'Date',
          yAxisLabel: 'Value',
          timeUnit: 'day'
        });

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
    // Clear previous chart if any
    if (this.currentChart && window.plotRenderer) {
      window.plotRenderer.destroyChart(this.currentChart);
      this.currentChart = null;
    }

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
          <canvas id="resultChart" width="800" height="400"></canvas>
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
    const canvasId = 'resultChart';

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
      this.currentChart = window.plotRenderer.renderPlot(canvasId, filteredRows, {
        title: selectedParameter || plotTitle,
        xAxisLabel: 'Date',
        yAxisLabel: 'Value',
        timeUnit: 'day'
      });

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

    this.finalizeAssistantMessage();

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
