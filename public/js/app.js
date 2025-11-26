(() => {
  // Report viewing elements (shown when ?reportId= parameter is present)
  const fileMessageEl = document.querySelector('#file-message');
  const resultEl = document.querySelector('#analysis-result');
  const detailsEl = document.querySelector('#analysis-details');
  const rawOutputEl = document.querySelector('#analysis-raw');

  // Check for reportId in URL parameters and auto-load report
  const urlParams = new URLSearchParams(window.location.search);
  const reportIdParam = urlParams.get('reportId');

  const progressBarEl = document.querySelector('#progress-bar');
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
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
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
      addRow('Entries', 'No parameters detected', { isMissing: true, isSubRow: true });
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

  // PRD v3.2: Initialize Conversational SQL Assistant
  let conversationalSQLChat = null;

  (async () => {
    const chatContainer = document.getElementById('conversational-chat-container');

    if (chatContainer && window.ConversationalSQLChat) {
      conversationalSQLChat = new window.ConversationalSQLChat();
      conversationalSQLChat.init(chatContainer);
      console.log('[app] Conversational SQL chat initialized');
    } else if (!window.ConversationalSQLChat) {
      console.error('[app] ConversationalSQLChat not loaded');
    }
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
            setResultMessage(`Loaded report with ${total} parameter${total === 1 ? '' : 's'}.`, 'success');
          } else {
            setResultMessage('Report loaded (no parameters detected).', 'info');
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
