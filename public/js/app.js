// ==================== AUTH CHECK (MUST BE FIRST) ====================
// CRITICAL: Make the entire IIFE async to block initialization until auth completes
// This prevents race conditions where DOM operations run before auth check finishes
(async () => {
  // Wait for auth.js to complete authentication check
  // RACE CONDITION FIX: auth.js calls requireAuth() immediately when loaded,
  // and exposes window.authReady promise that resolves when auth completes.
  // All app scripts await this promise to prevent API calls before auth verification.
  const isAuthenticated = await window.authReady;
  if (!isAuthenticated) {
    // Not authenticated - auth.js already redirected to login
    // Stop all app execution
    return;
  }

  // User is authenticated - display user info in header
  const user = authClient.getUser();
  console.log('[app] Logged in as:', user.display_name);
  displayUserInfo(user);

  // PRD v4.4.6: Hide Management section for non-admin users
  // Admin-only UI links (e.g., Review Queue) must be hidden for non-admin users
  if (!user.is_admin) {
    const managementSection = document.getElementById('management-section');
    if (managementSection) {
      managementSection.style.display = 'none';
      console.log('[app] Management section hidden for non-admin user');
    }
  }

  // ==================== APP INITIALIZATION (AUTH-GATED) ====================
  // ALL existing code runs here AFTER auth check succeeds
  // This ensures no UI flash or API calls happen before authentication

  function displayUserInfo(user) {
    // Add user menu to header using safe DOM methods (prevents XSS)
    const header = document.querySelector('.content-header-inner');
    if (!header) {
      console.warn('[app] Header element not found for user menu');
      return;
    }

    const userMenu = document.createElement('div');
    userMenu.className = 'user-menu';

    // Create avatar image with fallback for missing avatar_url
    const avatar = document.createElement('img');
    // Google OAuth always provides picture, but use fallback for defensive coding
    avatar.src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
    avatar.alt = user.display_name;
    avatar.className = 'user-avatar';
    avatar.onerror = function() {
      // Fallback if avatar_url fails to load
      this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
    };

    // Create user name span
    const userName = document.createElement('span');
    userName.className = 'user-name';
    userName.textContent = user.display_name; // textContent auto-escapes HTML

    // Create logout button
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logout-btn';
    logoutBtn.className = 'btn-logout';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', () => authClient.logout());

    // Assemble user menu
    userMenu.appendChild(avatar);
    userMenu.appendChild(userName);
    userMenu.appendChild(logoutBtn);
    header.appendChild(userMenu);
  }

  // Report viewing elements (shown when ?reportId= parameter is present)
  const fileMessageEl = document.querySelector('#file-message');
  const resultEl = document.querySelector('#analysis-result');
  const detailsEl = document.querySelector('#analysis-details');
  const rawOutputEl = document.querySelector('#analysis-raw');

  // Check for reportId in URL parameters and auto-load report
  const urlParams = new URLSearchParams(window.location.search);
  const reportIdParam = urlParams.get('reportId');

  const progressBarEl = document.querySelector('#progress-bar');
  const progressBarVisualEl = document.querySelector('#progress-bar-visual');
  const progressStepsEl = document.querySelector('#progress-steps');
  const progressContainerEl = progressBarEl?.parentElement || null;
  const pipelineSteps = [
    { id: 'uploaded', label: 'Upload received' },
    { id: 'pdf_processing', label: 'Processing document' },
    { id: 'openai_request', label: 'Analyzing with AI' },
    { id: 'parsing', label: 'Parsing results' },
    { id: 'persistence', label: 'Saving results' },
    { id: 'completed', label: 'Completed' },
  ];
  const UNAVAILABLE_LABEL = 'Unavailable';
  const stepLookup = pipelineSteps.reduce((acc, step, index) => {
    acc[step.id] = { ...step, index };
    return acc;
  }, {});

  const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

  const formatNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }

    if (isNonEmptyString(value)) {
      const numericCandidate = Number(value);
      if (Number.isFinite(numericCandidate)) {
        return value.trim();
      }
    }

    return '';
  };

  const fetchPersistedReport = async (reportId) => {
    if (typeof reportId !== 'string' || !reportId) {
      return null;
    }

    try {
      // PRD v4.4.6: Use endpoint resolver for admin access pattern
      const response = await fetch(window.getReportsEndpoint('/' + encodeURIComponent(reportId)));
      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[ui] Unable to fetch persisted report', error);
      return null;
    }
  };

  const hideDetails = () => {
    detailsEl.hidden = true;
    detailsEl.replaceChildren();
    if (progressBarEl) {
      progressBarEl.value = 0;
      progressBarEl.max = pipelineSteps.length;
      progressBarEl.dataset.status = 'idle';
    }
    if (progressBarVisualEl) {
      progressBarVisualEl.style.width = '0%';
      progressBarVisualEl.classList.remove('error', 'completed');
    }
    if (progressStepsEl) {
      progressStepsEl.replaceChildren();
    }
    if (progressContainerEl) {
      progressContainerEl.hidden = true;
    }
  };

  const renderProgress = (progress = []) => {
    if (!progressBarEl || !progressStepsEl) {
      return;
    }

    if (progressContainerEl) {
      progressContainerEl.hidden = false;
    }

    const merged = pipelineSteps.map((step) => ({
      ...step,
      status: 'pending',
      message: null,
      timestamp: null,
    }));

    progress.forEach((entry) => {
      const stepMeta = stepLookup[entry.id];
      if (!stepMeta) {
        return;
      }
      merged[stepMeta.index] = {
        ...merged[stepMeta.index],
        ...entry,
      };
    });

    let completedCount = 0;
    merged.forEach((step, index) => {
      if (step.status === 'completed') {
        completedCount = index + 1;
      }
      if (step.status === 'failed') {
        completedCount = Math.max(completedCount, index);
      }
    });

    progressBarEl.max = pipelineSteps.length;
    progressBarEl.value = completedCount;
    progressBarEl.dataset.status = merged.some((step) => step.status === 'failed')
      ? 'failed'
      : merged[merged.length - 1].status === 'completed'
        ? 'completed'
        : 'in_progress';
    if (progressBarVisualEl) {
      const percent = Math.min((completedCount / pipelineSteps.length) * 100, 100);
      progressBarVisualEl.style.width = `${percent}%`;
      progressBarVisualEl.classList.remove('error', 'completed');
      if (merged.some((step) => step.status === 'failed')) {
        progressBarVisualEl.classList.add('error');
      } else if (merged[merged.length - 1].status === 'completed') {
        progressBarVisualEl.classList.add('completed');
      }
    }

    const fragment = document.createDocumentFragment();
    merged.forEach((step, index) => {
      const item = document.createElement('div');
      item.className = 'progress-step';
      item.dataset.status = step.status || 'pending';
      item.dataset.index = index + 1;

      const badge = document.createElement('span');
      badge.className = 'progress-step__badge';
      badge.textContent = index + 1;
      item.appendChild(badge);

      const content = document.createElement('div');
      content.className = 'progress-step__content';

      const title = document.createElement('span');
      title.className = 'progress-step__label';
      title.textContent = step.label;
      content.appendChild(title);

      if (step.message) {
        const message = document.createElement('span');
        message.className = 'progress-step__message';
        message.textContent = step.message;
        content.appendChild(message);
      }

      item.appendChild(content);
      fragment.append(item);
    });

    progressStepsEl.replaceChildren(fragment);
  };

  const buildReferenceIntervalDisplay = (referenceInterval) => {
    if (!referenceInterval || typeof referenceInterval !== 'object') {
      return '';
    }

    const lower = formatNumber(referenceInterval.lower);
    const upper = formatNumber(referenceInterval.upper);
    const lowerOperator = typeof referenceInterval.lower_operator === 'string'
      ? referenceInterval.lower_operator.trim()
      : null;
    const upperOperator = typeof referenceInterval.upper_operator === 'string'
      ? referenceInterval.upper_operator.trim()
      : null;
    const text = isNonEmptyString(referenceInterval.text) ? referenceInterval.text.trim() : '';

    const operatorToSymbol = (operator, { fallback } = {}) => {
      switch (operator) {
        case '>':
          return '>';
        case '>=':
          return '≥';
        case '<':
          return '<';
        case '<=':
          return '≤';
        case '=':
          return '=';
        default:
          if (fallback === 'lower') {
            return '≥';
          }
          if (fallback === 'upper') {
            return '≤';
          }
          return '=';
      }
    };

    if (lower && upper) {
      const lowerSymbol = operatorToSymbol(lowerOperator, { fallback: 'lower' });
      const upperSymbol = operatorToSymbol(upperOperator, { fallback: 'upper' });
      const isInclusiveLower = lowerSymbol === '≥' || lowerSymbol === '=';
      const isInclusiveUpper = upperSymbol === '≤' || upperSymbol === '=';

      if (isInclusiveLower && isInclusiveUpper) {
        return `${lower} - ${upper}`;
      }

      const parts = [];
      parts.push(`${lowerSymbol} ${lower}`);
      parts.push(`${upperSymbol} ${upper}`);
      return parts.join(', ');
    }

    if (lower) {
      const symbol = operatorToSymbol(lowerOperator, { fallback: 'lower' });
      return `${symbol} ${lower}`;
    }

    if (upper) {
      const symbol = operatorToSymbol(upperOperator, { fallback: 'upper' });
      return `${symbol} ${upper}`;
    }

    return text;
  };

  const renderDetails = (payload, elapsedMs = null) => {
    if (!payload || typeof payload !== 'object') {
      hideDetails();
      return;
    }

    const fragment = document.createDocumentFragment();

    const addRow = (label, value, { isMissing = false, isSubRow = false } = {}) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'result-details__row';

      if (isSubRow) {
        rowEl.classList.add('result-details__row--sub');
      }

      const labelEl = document.createElement('span');
      labelEl.className = 'result-details__label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.className = 'result-details__value';
      valueEl.textContent = value;

      if (isMissing) {
        valueEl.classList.add('result-details__value--missing');
      }

      rowEl.append(labelEl, valueEl);
      fragment.append(rowEl);
      return rowEl;
    };

    const addSectionTitle = (title) => {
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'result-details__section-title';
      sectionTitle.textContent = title;
      fragment.append(sectionTitle);
      return sectionTitle;
    };

    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      const seconds = (elapsedMs / 1000).toFixed(1);
      addRow('Processing Time', `${seconds} s`);
    }

    const patientName = isNonEmptyString(payload.patient_name)
      ? payload.patient_name.trim()
      : 'Missing';
    addRow('Patient Name', patientName, { isMissing: !isNonEmptyString(payload.patient_name) });

    const ageCandidates = [
      payload.patient_age,
      payload.age,
      payload.demographics && payload.demographics.age,
    ];
    let ageValue = '';
    for (let index = 0; index < ageCandidates.length; index += 1) {
      const candidate = ageCandidates[index];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        ageValue = candidate.toString();
        break;
      }
      if (isNonEmptyString(candidate)) {
        ageValue = candidate.trim();
        break;
      }
    }

    const ageDisplay = ageValue || UNAVAILABLE_LABEL;
    addRow('Age', ageDisplay, { isMissing: ageDisplay === UNAVAILABLE_LABEL });

    const rawDateOfBirth = isNonEmptyString(payload.patient_date_of_birth)
      ? payload.patient_date_of_birth
      : payload.date_of_birth;
    const dateOfBirth = isNonEmptyString(rawDateOfBirth)
      ? rawDateOfBirth.trim()
      : UNAVAILABLE_LABEL;
    addRow('Date of Birth', dateOfBirth, { isMissing: dateOfBirth === UNAVAILABLE_LABEL });

    const rawGender = isNonEmptyString(payload.patient_gender)
      ? payload.patient_gender
      : payload.gender;
    const gender = isNonEmptyString(rawGender)
      ? rawGender.trim()
      : 'Missing';
    addRow('Gender', gender, { isMissing: !isNonEmptyString(rawGender) });

    let testDate = isNonEmptyString(payload.test_date) ? payload.test_date.trim() : '';
    if (!testDate && payload.lab_dates && typeof payload.lab_dates === 'object') {
      if (isNonEmptyString(payload.lab_dates.primary_test_date)) {
        testDate = payload.lab_dates.primary_test_date.trim();
      } else if (Array.isArray(payload.lab_dates.secondary_dates)) {
        const fallback = payload.lab_dates.secondary_dates
          .map((entry) => (entry && isNonEmptyString(entry.value) ? entry.value.trim() : ''))
          .find((value) => Boolean(value));
        if (fallback) {
          testDate = fallback;
        }
      }
    }

    addRow('Test Date', testDate || 'Missing', {
      isMissing: !testDate,
    });

    const parameters = Array.isArray(payload.parameters) ? payload.parameters : [];
    const missingData = Array.isArray(payload.missing_data) ? payload.missing_data : [];
    const MISSING_NULL_KEY = '__UNKNOWN_PARAMETER__';

    const buildMissingKey = (name) => (isNonEmptyString(name) ? name.trim() : MISSING_NULL_KEY);

    const missingLookup = new Map();
    missingData.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      const key = buildMissingKey(entry.parameter_name);
      const fields = Array.isArray(entry.missing_fields)
        ? entry.missing_fields
            .map((field) => (typeof field === 'string' ? field.trim() : ''))
            .filter(Boolean)
        : [];

      if (!fields.length) {
        return;
      }

      const existing = missingLookup.get(key) || [];
      existing.push(fields);
      missingLookup.set(key, existing);
    });

    addSectionTitle('Parameters');

    if (!parameters.length) {
      // PRD v3.8: Handle zero-result reports (non-blood/non-urine tests)
      const noResultsRow = document.createElement('div');
      noResultsRow.className = 'result-details__row result-details__row--empty-state';
      noResultsRow.innerHTML = `
        <div style="text-align: center; padding: 1.5rem; color: #666;">
          <p style="margin-bottom: 0.75rem; font-size: 1.1em;">No blood or urine test results found in this document.</p>
          <p style="margin-bottom: 1rem; color: #888; font-size: 0.9em;">This document may contain imaging, cytology, or other non-blood/urine tests.</p>
          <button type="button" onclick="viewOriginalFile()" class="secondary-button" style="cursor: pointer;">
            📄 View Original File
          </button>
        </div>
      `;
      fragment.append(noResultsRow);
    } else {
      const tableWrapper = document.createElement('div');
      tableWrapper.className = 'parameters-table-wrapper';

      const table = document.createElement('table');
      table.className = 'parameters-table';

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

      parameters.forEach((parameter, index) => {
        const entry = parameter && typeof parameter === 'object' ? parameter : {};
        const row = document.createElement('tr');

        const buildCell = (text, { isMissing = false } = {}) => {
          const cell = document.createElement('td');
          cell.textContent = text;
          if (isMissing) {
            cell.dataset.missing = 'true';
          }
          return cell;
        };

        const missingKey = buildMissingKey(entry.parameter_name);
        const missingForParameter = missingLookup.get(missingKey);
        let missingFieldsForRow = [];

        if (missingForParameter && missingForParameter.length) {
          const fieldsForRow = missingForParameter.shift();
          if (Array.isArray(fieldsForRow)) {
            missingFieldsForRow = fieldsForRow;
          }
          if (!missingForParameter.length) {
            missingLookup.delete(missingKey);
          } else {
            missingLookup.set(missingKey, missingForParameter);
          }
        }

        const normalizedMissingFields = missingFieldsForRow
          .map((field) => (typeof field === 'string' ? field.trim().toLowerCase() : ''))
          .filter(Boolean);
        const isFieldMarkedMissing = (fieldName, synonyms = []) => {
          if (!normalizedMissingFields.length) {
            return false;
          }

          const candidates = [fieldName, ...synonyms]
            .map((candidate) => candidate.toLowerCase())
            .filter(Boolean);

          return normalizedMissingFields.some((value) => (
            candidates.some((candidate) => value === candidate || value.startsWith(`${candidate}.`))
          ));
        };

        const hasParameterName = isNonEmptyString(entry.parameter_name);
        const name = hasParameterName ? entry.parameter_name.trim() : `Parameter ${index + 1}`;
        row.appendChild(buildCell(name, {
          isMissing: !hasParameterName || isFieldMarkedMissing('parameter_name', ['parameter']),
        }));

        let resultDisplay = '';
        if (typeof entry.result === 'number' && Number.isFinite(entry.result)) {
          resultDisplay = entry.result.toString();
        } else if (isNonEmptyString(entry.result)) {
          resultDisplay = entry.result.trim();
        } else {
          const fallbackNumeric = formatNumber(entry.value);
          const fallbackTextual = isNonEmptyString(entry.value_text) ? entry.value_text.trim() : '';
          const parts = [];
          if (fallbackNumeric) {
            parts.push(fallbackNumeric);
          }
          if (fallbackTextual) {
            parts.push(fallbackTextual);
          }
          if (parts.length) {
            resultDisplay = parts.join(' ');
          }
        }

        const resultCell = document.createElement('td');
        if (resultDisplay) {
          resultDisplay.split(/\r?\n/).forEach((line, lineIndex) => {
            if (lineIndex > 0) {
              resultCell.append(document.createElement('br'));
            }
            resultCell.append(line);
          });
        } else {
          resultCell.textContent = '--';
        }

        if (!resultDisplay || isFieldMarkedMissing('result', ['value', 'value_text'])) {
          resultCell.dataset.missing = 'true';
        }

        if (entry && entry.is_value_out_of_range === true) {
          resultCell.dataset.outOfRange = 'true';
        }

        row.appendChild(resultCell);

        const unitText = isNonEmptyString(entry.unit) ? entry.unit.trim() : '--';
        row.appendChild(buildCell(unitText || '--', {
          isMissing: !isNonEmptyString(entry.unit) || isFieldMarkedMissing('unit'),
        }));

        const referenceDisplay = buildReferenceIntervalDisplay(entry.reference_interval);
        const referenceCell = document.createElement('td');

        if (isNonEmptyString(referenceDisplay)) {
          referenceCell.textContent = referenceDisplay;
        } else {
          referenceCell.textContent = UNAVAILABLE_LABEL;
        }

        if (!isNonEmptyString(referenceDisplay) || isFieldMarkedMissing('reference_interval')) {
          referenceCell.dataset.missing = 'true';
        }

        row.appendChild(referenceCell);

        tbody.appendChild(row);
      });

      table.append(thead, tbody);
      tableWrapper.append(table);
      fragment.append(tableWrapper);
    }

    const leftoverMissing = Array.from(missingLookup.entries())
      .flatMap(([key, fieldLists]) => fieldLists.map((fields) => ({ key, fields })))
      .filter((item) => Array.isArray(item.fields) && item.fields.length);

    if (leftoverMissing.length) {
      addSectionTitle('Additional Missing Data');
      leftoverMissing.forEach(({ key, fields }) => {
        const label = key === MISSING_NULL_KEY ? 'Unmapped parameter' : key;
        addRow(label, fields.join(', '), { isMissing: true, isSubRow: true });
      });
    }

    detailsEl.replaceChildren(fragment);
    detailsEl.hidden = false;
  };

  const updateFileMessage = (fileName) => {
    if (fileName) {
      fileMessageEl.textContent = `You selected: ${fileName}`;
      fileMessageEl.hidden = false;
    } else {
      fileMessageEl.textContent = '';
      fileMessageEl.hidden = true;
    }
  };

  const setResultMessage = (message, state = 'idle') => {
    if (!message) {
      resultEl.textContent = '';
      resultEl.hidden = true;
      resultEl.dataset.state = 'idle';
      rawOutputEl.textContent = '';
      rawOutputEl.hidden = true;
      hideDetails();
      return;
    }

    resultEl.textContent = message;
    resultEl.hidden = false;
    resultEl.dataset.state = state;
  };

  const setRawOutput = (rawOutput) => {
    if (typeof rawOutput !== 'string' || !rawOutput.trim()) {
      rawOutputEl.textContent = '';
      rawOutputEl.hidden = true;
      return;
    }

    rawOutputEl.textContent = rawOutput.trim();
    rawOutputEl.hidden = false;
  };

  // Old upload functionality removed (now handled by unified-upload.js)
  // Kept here as dead code for reference during transition

  // Map numeric progress (0-100) to pipeline steps
  const mapProgressToSteps = (progressPercent, jobStatus) => {
    const steps = [];

    // Define progress ranges for each step
    // Based on backend progress milestones in labReportProcessor.js
    const ranges = [
      { id: 'uploaded', min: 0, max: 9 },
      { id: 'pdf_processing', min: 10, max: 39 },
      { id: 'openai_request', min: 40, max: 74 },
      { id: 'parsing', min: 75, max: 79 },
      { id: 'persistence', min: 80, max: 99 },
      { id: 'completed', min: 100, max: 100 }
    ];

    ranges.forEach((range) => {
      let status = 'pending';
      let message = null;

      if (progressPercent >= range.max) {
        // Step fully completed
        status = 'completed';
      } else if (progressPercent >= range.min && progressPercent < range.max) {
        // Step currently in progress
        status = 'in_progress';
      }

      // If job failed, mark current step as failed
      if (jobStatus === 'failed' && status === 'in_progress') {
        status = 'failed';
      }

      steps.push({ id: range.id, status, message });
    });

    return steps;
  };

  // Helper function to poll job status
  const pollJobStatus = async (jobId, onProgress) => {
    const maxAttempts = 150; // 150 * 4s = 10 minutes max
    const pollInterval = 4000; // 4 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const response = await fetch(`/api/analyze-labs/jobs/${jobId}`);

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Job not found or expired');
          }
          throw new Error('Failed to check job status');
        }

        const jobStatus = await response.json();

        // Update progress if callback provided
        if (onProgress && jobStatus.progress !== undefined) {
          onProgress(jobStatus.progress, jobStatus.progressMessage, jobStatus.status);
        }

        // Check if job is complete
        if (jobStatus.status === 'completed') {
          return jobStatus.result;
        }

        // Check if job failed
        if (jobStatus.status === 'failed') {
          throw new Error(jobStatus.error || 'Analysis failed');
        }

        // Continue polling (pending or processing)
      } catch (error) {
        // Re-throw for final error handling
        throw error;
      }
    }

    throw new Error('Analysis timed out. Please try again.');
  };


  // Old upload button event listener removed (functionality moved to unified-upload.js)

  // PRD v3.2: Initialize Conversational SQL Assistant (lazy-init when visible)
  // PRD v5.0: Enhanced to support onboarding context from landing page
  let conversationalSQLChat = null;
  let chatInitialized = false;
  const assistantSection = document.getElementById('section-assistant');
  const chatContainer = document.getElementById('conversational-chat-container');

  /**
   * PRD v5.0: Handle onboarding context from landing page
   * Reads sessionStorage, creates session with initial_context, connects SSE,
   * and calls chat.initWithExistingSession() for seamless transition.
   * @returns {Promise<boolean>} True if onboarding was handled, false otherwise
   */
  async function handleOnboardingContext() {
    const contextJson = sessionStorage.getItem('onboarding_context');
    if (!contextJson) {
      return false;
    }

    try {
      const context = JSON.parse(contextJson);
      // eslint-disable-next-line no-console
      console.log('[app] Onboarding context found:', {
        insight: context.insight?.substring(0, 50) + '...',
        selected_query: context.selected_query,
        patient_id: context.patient_id
      });

      // Clear sessionStorage immediately to prevent reprocessing on refresh
      sessionStorage.removeItem('onboarding_context');

      if (!window.ConversationalSQLChat) {
        console.error('[app] ConversationalSQLChat not loaded for onboarding');
        return false;
      }

      // Step 1: Create session with initial_context
      // NOTE: Server expects 'selectedPatientId' not 'patient_id'
      const sessionResponse = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          selectedPatientId: context.patient_id,
          initial_context: {
            insight: context.insight,
            report_ids: context.report_ids,
            patient_name: context.patient_name,
            lab_data: context.lab_data || []  // PRD v5.0: Include lab data for system prompt
          }
        })
      });

      if (!sessionResponse.ok) {
        const error = await sessionResponse.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to create session');
      }

      const { sessionId } = await sessionResponse.json();
      // Construct SSE stream URL (not returned by POST /sessions)
      const streamUrl = `/api/chat/stream?sessionId=${sessionId}`;
      // eslint-disable-next-line no-console
      console.log('[app] Onboarding session created:', sessionId);
      // eslint-disable-next-line no-console
      console.log('[app] Onboarding patient_name:', context.patient_name);

      // Step 2: Connect SSE and WAIT for connection to be established
      // PRD v5.0: Use auth-aware EventSource for 401 handling (same as chat.js)
      const eventSource = window.createAuthAwareEventSource(streamUrl);

      // CRITICAL: Wait for SSE connection to open before initializing chat
      // Without this, message sends before server can receive SSE events
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('SSE connection timeout'));
        }, 10000); // 10 second timeout

        eventSource.onopen = () => {
          clearTimeout(timeout);
          // eslint-disable-next-line no-console
          console.log('[app] SSE connection established for onboarding');
          resolve();
        };

        eventSource.onerror = (err) => {
          clearTimeout(timeout);
          eventSource.close(); // Prevent dangling connection on error
          reject(new Error('SSE connection failed'));
        };
      });

      // Step 3: Initialize chat with existing session (SSE now connected)
      conversationalSQLChat = new window.ConversationalSQLChat();
      conversationalSQLChat.initWithExistingSession(chatContainer, {
        sessionId,
        eventSource,
        selectedPatientId: context.patient_id,
        patientName: context.patient_name,
        pendingQuery: context.selected_query
      });

      chatInitialized = true;
      // eslint-disable-next-line no-console
      console.log('[app] Onboarding chat initialized with existing session');

      return true;

    } catch (error) {
      console.error('[app] Failed to handle onboarding context:', error);
      // Clear sessionStorage to avoid retry loop
      sessionStorage.removeItem('onboarding_context');
      return false;
    }
  }

  const initChatIfVisible = () => {
    if (chatInitialized || !chatContainer || !assistantSection) {
      return;
    }
    if (getComputedStyle(assistantSection).display === 'none') {
      return;
    }
    if (!window.ConversationalSQLChat) {
      // eslint-disable-next-line no-console
      console.error('[app] ConversationalSQLChat not loaded');
      return;
    }
    conversationalSQLChat = new window.ConversationalSQLChat();
    conversationalSQLChat.init(chatContainer);
    chatInitialized = true;
    // eslint-disable-next-line no-console
    console.log('[app] Conversational SQL chat initialized');
  };

  // PRD v5.0: Check for onboarding context BEFORE setting up lazy-init
  // This ensures we handle onboarding immediately when coming from landing page
  // CRITICAL: Must complete before initChatIfVisible() runs to prevent race condition
  (async () => {
    const hasOnboarding = await handleOnboardingContext();
    if (hasOnboarding) {
      // Navigate to assistant section and show it
      const hash = window.location.hash;
      if (hash !== '#assistant') {
        window.location.hash = '#assistant';
      }
      // Force section visibility (hash handler may not have run yet)
      if (assistantSection) {
        assistantSection.style.display = 'block';
        document.querySelectorAll('.content-section').forEach(section => {
          if (section.id !== 'section-assistant') {
            section.style.display = 'none';
          }
        });
      }
      // Don't set up lazy-init - chat already initialized via onboarding
      return;
    }

    // No onboarding - set up normal lazy-init for chat
    if (assistantSection && 'MutationObserver' in window) {
      const observer = new MutationObserver(() => initChatIfVisible());
      observer.observe(assistantSection, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    }
    // Initial check in case assistant is shown on load
    initChatIfVisible();
  })();

  // Auto-load report if reportId is in URL parameters
  if (reportIdParam) {
    (async () => {
      try {
        setResultMessage('Loading report...', 'loading');
        const persistedPayload = await fetchPersistedReport(reportIdParam);

        if (persistedPayload) {
          renderDetails(persistedPayload, 0);

          const parametersForMessage = Array.isArray(persistedPayload.parameters)
            ? persistedPayload.parameters
            : [];
          const total = parametersForMessage.length;

          if (total > 0) {
            setResultMessage(`Loaded report with ${total} blood/urine test result${total === 1 ? '' : 's'}.`, 'success');
          } else {
            setResultMessage('No blood or urine test results found in this document.', 'info');
          }
        } else {
          setResultMessage('Report not found.', 'error');
        }
      } catch (error) {
        console.error('Failed to load report:', error);
        setResultMessage('Failed to load report.', 'error');
      }
    })();
  }
})();

// View Original File function (global scope for onclick handler)
function viewOriginalFile() {
  const urlParams = new URLSearchParams(window.location.search);
  const reportId = urlParams.get('reportId');

  if (!reportId) {
    alert('Report ID not found');
    return;
  }

  // Open file in new tab
  // Server returns 410 Gone JSON if file not available (legacy reports)
  // PRD v4.4.6: Use endpoint resolver for admin access pattern
  const url = window.getReportsEndpoint('/' + reportId + '/original-file');
  window.open(url, '_blank');
}
