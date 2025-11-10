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

  const sqlQuestionInput = document.querySelector('#sql-question');
  const sqlGenerateBtn = document.querySelector('#sql-generate-btn');
  const sqlStatusEl = document.querySelector('#sql-status');

  // Data results elements
  const dataResultsSection = document.getElementById('data-results-section');
  const dataResultsTbody = document.getElementById('data-results-tbody');
  const rowCountMsg = document.getElementById('row-count-message');

  if (
    sqlQuestionInput
    && sqlGenerateBtn
  ) {
    let lastQuestion = '';
    let isGeneratingSql = false;
    let copyFeedbackTimeout = null;

    const normalizeInput = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

    const setSqlStatus = (message, state) => {
      if (!sqlStatusEl) {
        return;
      }

      if (!message) {
        sqlStatusEl.hidden = true;
        sqlStatusEl.textContent = '';
        delete sqlStatusEl.dataset.state;
        return;
      }

      sqlStatusEl.hidden = false;
      sqlStatusEl.textContent = message;
      if (state) {
        sqlStatusEl.dataset.state = state;
      } else {
        delete sqlStatusEl.dataset.state;
      }
    };

    const setSqlLoadingState = (isLoading) => {
      isGeneratingSql = isLoading;
      sqlGenerateBtn.disabled = isLoading;
    };


    // Track current chart instance for cleanup
    let currentChart = null;
    // Track parameter selector listener to avoid duplicate bindings
    let parameterSelectorChangeHandler = null;

    /**
     * Render parameter table below plot (v2.6)
     * @param {Array} rows - Filtered dataset for selected parameter
     * @param {string} parameterName - Currently selected parameter name
     */
    const renderParameterTable = (rows, parameterName) => {
      const container = document.getElementById('parameter-table-container');
      if (!container) return;

      // Hide table if no data
      if (!rows || rows.length === 0) {
        container.replaceChildren();
        container.hidden = true;
        return;
      }

      // Debug: Log first row to see what fields are available
      console.log('[renderParameterTable] First row data:', rows[0]);

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

      // Map prefixed field names to unprefixed for helper function
      const mapToUnprefixed = (row) => ({
        lower: row.reference_lower,
        upper: row.reference_upper,
        lower_operator: row.reference_lower_operator,
        upper_operator: row.reference_upper_operator,
        text: row.reference_interval_text || ''
      });

      // Build table structure
      const tableWrapper = document.createElement('div');
      tableWrapper.className = 'parameters-table-wrapper';

      const table = document.createElement('table');
      table.className = 'parameters-table';

      // Add caption for accessibility
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

        // Calculate if value is out of range (frontend calculation as fallback)
        let isOutOfRange = row.is_out_of_range === true || row.is_value_out_of_range === true;

        // If backend flag not present, calculate it ourselves
        if (!isOutOfRange && row.y !== null && row.y !== undefined) {
          const value = parseFloat(row.y);
          if (!isNaN(value)) {
            const lower = row.reference_lower !== null && row.reference_lower !== undefined
              ? parseFloat(row.reference_lower)
              : null;
            const upper = row.reference_upper !== null && row.reference_upper !== undefined
              ? parseFloat(row.reference_upper)
              : null;

            if (lower !== null) {
              const lowerOp = row.reference_lower_operator || '>=';
              if ((lowerOp === '>' && value <= lower) ||
                  (lowerOp === '>=' && value < lower) ||
                  (lowerOp === '<' && value >= lower) ||
                  (lowerOp === '<=' && value > lower)) {
                isOutOfRange = true;
              }
            }

            if (upper !== null && !isOutOfRange) {
              const upperOp = row.reference_upper_operator || '<=';
              if ((upperOp === '<' && value >= upper) ||
                  (upperOp === '<=' && value > upper) ||
                  (upperOp === '>' && value <= upper) ||
                  (upperOp === '>=' && value < upper)) {
                isOutOfRange = true;
              }
            }
          }
        }

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
        const refDisplay = buildReferenceIntervalDisplay(mapToUnprefixed(row));
        refCell.textContent = refDisplay || 'Unavailable';
        tr.appendChild(refCell);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      tableWrapper.appendChild(table);
      container.replaceChildren(tableWrapper);
      container.hidden = false;
    };

    /**
     * Build parameter selector UI from plot data
     * @param {Array} rows - Full dataset with parameter_name field
     * @param {string} containerId - ID of selector container element
     * @returns {string|null} - Selected parameter name (default: first alphabetically)
     */
    const renderParameterSelector = (rows, containerId) => {
      const container = document.getElementById(containerId);
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
        radio.name = 'parameter';
        radio.value = param;
        radio.checked = index === 0; // Default: first alphabetically

        const text = document.createTextNode(` ${param} (${paramCounts[param]})`);

        label.appendChild(radio);
        label.appendChild(text);
        fragment.appendChild(label);
      });

      container.replaceChildren(fragment);

      return parameters[0]; // Return default selection
    };

    /**
     * Attach event listener for parameter switching
     * @param {Array} allRows - Full dataset with all parameters
     * @param {string} plotTitle - Base plot title
     */
    const attachParameterSelectorListener = (allRows, plotTitle) => {
      const container = document.getElementById('parameter-list');
      if (!container) return;

      if (parameterSelectorChangeHandler) {
        container.removeEventListener('change', parameterSelectorChangeHandler);
      }

      parameterSelectorChangeHandler = (event) => {
        if (event.target.type === 'radio' && event.target.name === 'parameter') {
          const selectedParameter = event.target.value;

          // Filter data client-side
          const filteredRows = allRows.filter(row => row.parameter_name === selectedParameter);

          // Destroy existing chart
          if (currentChart && window.plotRenderer) {
            window.plotRenderer.destroyChart(currentChart);
          }

          // Re-render with filtered data
          currentChart = window.plotRenderer.renderPlot('plot-canvas', filteredRows, {
            title: selectedParameter || plotTitle,
            xAxisLabel: 'Date',
            yAxisLabel: 'Value',
            timeUnit: 'day'
          });

          // Update parameter table (v2.6)
          renderParameterTable(filteredRows, selectedParameter);
        }
      };

      container.addEventListener('change', parameterSelectorChangeHandler);
    };

    /**
     * Render plot visualization for plot_query responses
     * Executes SQL and displays Chart.js plot
     */
    const renderPlotVisualization = async (payload) => {
      console.log('[app] renderPlotVisualization called', {
        hasPayload: !!payload,
        queryType: payload?.query_type,
        hasPlotRenderer: !!window.plotRenderer,
        hasChart: !!window.Chart
      });

      const plotContainer = document.getElementById('plot-container');
      const plotCanvas = document.getElementById('plot-canvas');
      const plotResetBtn = document.getElementById('plot-reset-btn');

      if (!plotContainer || !plotCanvas) {
        console.error('[app] Plot container or canvas not found', {
          hasContainer: !!plotContainer,
          hasCanvas: !!plotCanvas
        });
        return;
      }

      if (!payload.sql || !window.plotRenderer) {
        console.error('[app] Cannot render plot: missing SQL or plotRenderer', {
          hasSql: !!payload.sql,
          hasPlotRenderer: !!window.plotRenderer
        });
        return;
      }

      try {
        console.log('[app] Starting plot rendering...');

        // Hide reset button until chart is ready
        if (plotResetBtn) {
          plotResetBtn.hidden = true;
          plotResetBtn.disabled = true;
          plotResetBtn.onclick = null;
        }

        // Hide table during loading (PRD v2.6 requirement)
        const tableContainer = document.getElementById('parameter-table-container');
        if (tableContainer) {
          console.log('[app] Hiding table before fetch');
          tableContainer.hidden = true;
          tableContainer.replaceChildren(); // Clear stale content
        }

        // IMPORTANT: Unhide BOTH containers BEFORE rendering
        // Chart.js needs the canvas to be visible to calculate dimensions
        const visualizationContainer = document.getElementById('plot-visualization-container');
        if (visualizationContainer) {
          visualizationContainer.hidden = false;
        }
        plotContainer.hidden = false;

        // Show loading state
        setSqlStatus('Executing query and generating plot...', 'loading');

        // Execute SQL via backend
        const response = await fetch('/api/execute-sql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sql: payload.sql })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || 'Failed to execute plot query';
          throw new Error(errorMessage);
        }

        const result = await response.json();
        const rows = result.rows || [];

        console.log('[app] Received data from API:', {
          rowCount: rows.length,
          firstRow: rows[0],
          fields: result.fields
        });

        if (!rows.length) {
          setSqlStatus('No data available for plotting', 'info');

          // Hide plot container, wrapper, and table (no data to display)
          const visualizationContainer = document.getElementById('plot-visualization-container');
          if (visualizationContainer) {
            visualizationContainer.hidden = true;
          }
          plotContainer.hidden = true;

          const tableContainer = document.getElementById('parameter-table-container');
          if (tableContainer) {
            tableContainer.hidden = true;
            tableContainer.replaceChildren();
          }

          if (plotResetBtn) {
            plotResetBtn.hidden = true;
            plotResetBtn.disabled = true;
          }
          return;
        }

        // Validate data structure and preserve all reference range fields
        const validRows = rows.filter(row => {
          const hasT = row.t !== null && row.t !== undefined;
          const hasY = row.y !== null && row.y !== undefined && !isNaN(parseFloat(row.y));
          if (!hasT || !hasY) {
            console.warn('[app] Invalid row:', row);
          }
          return hasT && hasY;
        }).map(row => ({
          // Core required fields
          t: row.t,
          y: row.y,
          parameter_name: row.parameter_name,
          unit: row.unit || 'unknown',
          // Reference range fields (preserve for band rendering and table display)
          reference_lower: row.reference_lower,
          reference_lower_operator: row.reference_lower_operator,
          reference_upper: row.reference_upper,
          reference_upper_operator: row.reference_upper_operator,
          reference_interval_text: row.reference_interval_text, // For table fallback display
          is_value_out_of_range: row.is_value_out_of_range,
          // Optional context
          patient_age_snapshot: row.patient_age_snapshot,
          patient_gender_snapshot: row.patient_gender_snapshot
        }));

        console.log('[app] Valid rows after filtering:', {
          total: rows.length,
          valid: validRows.length,
          sample: validRows.slice(0, 3),
          hasReferenceBands: validRows.some(r => r.reference_lower !== null || r.reference_upper !== null)
        });

        if (!validRows.length) {
          setSqlStatus('No valid data points for plotting (all values are null or invalid)', 'info');

          // Hide both the plot container and wrapper
          const visualizationContainer = document.getElementById('plot-visualization-container');
          if (visualizationContainer) {
            visualizationContainer.hidden = true;
          }
          plotContainer.hidden = true;

          if (plotResetBtn) {
            plotResetBtn.hidden = true;
            plotResetBtn.disabled = true;
          }
          return;
        }

        // Extract meaningful title from plot_title or explanation
        let plotTitle = 'Lab Results Over Time'; // Fallback

        // Prefer plot_title if provided by LLM
        if (payload.plot_title && typeof payload.plot_title === 'string') {
          plotTitle = payload.plot_title.trim();
        } else if (payload.explanation) {
          // Fallback: Use first sentence from explanation (up to 100 chars)
          const firstSentence = payload.explanation.split(/[.!?]/)[0].trim();
          if (firstSentence.length > 0 && firstSentence.length <= 100) {
            plotTitle = firstSentence;
          } else if (firstSentence.length > 100) {
            // Truncate long explanations
            plotTitle = firstSentence.substring(0, 97) + '...';
          }
        }

        // Show parameter selector and filter data
        const selectedParameter = renderParameterSelector(validRows, 'parameter-list');

        // Filter to selected parameter (or use all data if no parameter_name)
        let filteredRows = validRows;
        if (selectedParameter) {
          filteredRows = validRows.filter(row => row.parameter_name === selectedParameter);
        }

        // Render plot with filtered data
        currentChart = window.plotRenderer.renderPlot('plot-canvas', filteredRows, {
          title: selectedParameter || plotTitle,
          xAxisLabel: 'Date',
          yAxisLabel: 'Value',
          timeUnit: 'day'
        });

        // Render parameter table for initial load (v2.6)
        if (selectedParameter && filteredRows.length > 0) {
          renderParameterTable(filteredRows, selectedParameter);
        }

        if (currentChart) {
          // Show the wrapper container instead of just plot-container
          const visualizationContainer = document.getElementById('plot-visualization-container');
          if (visualizationContainer) {
            visualizationContainer.hidden = false;
          }
          plotContainer.hidden = false;

          // Attach parameter selector event listener
          attachParameterSelectorListener(validRows, plotTitle);
          if (plotResetBtn && typeof currentChart.resetZoom === 'function') {
            plotResetBtn.hidden = false;
            plotResetBtn.disabled = false;
            plotResetBtn.onclick = () => {
              if (currentChart && typeof currentChart.resetZoom === 'function') {
                currentChart.resetZoom();
              }
            };
          }
          console.log('[app] Chart created, showing container:', {
            chartId: currentChart.id,
            containerHidden: plotContainer.hidden,
            canvasVisible: document.getElementById('plot-canvas')?.offsetWidth > 0
          });
          setSqlStatus('Plot generated successfully. SQL query shown above.', 'success');
        } else {
          console.error('[app] Chart creation returned null');
          throw new Error('Failed to create chart');
        }
      } catch (error) {
        console.error('[app] Plot rendering error:', error);
        setSqlStatus(`Plot generation failed: ${error.message}. Showing SQL query only.`, 'error');

        // Hide plot container, wrapper, and table (error state)
        const visualizationContainer = document.getElementById('plot-visualization-container');
        if (visualizationContainer) {
          visualizationContainer.hidden = true;
        }
        plotContainer.hidden = true;

        const tableContainer = document.getElementById('parameter-table-container');
        if (tableContainer) {
          tableContainer.hidden = true;
          tableContainer.replaceChildren();
        }

        if (plotResetBtn) {
          plotResetBtn.hidden = true;
          plotResetBtn.disabled = true;
          plotResetBtn.onclick = null;
        }

        const parameterListEl = document.getElementById('parameter-list');
        if (parameterListEl && parameterSelectorChangeHandler) {
          parameterListEl.removeEventListener('change', parameterSelectorChangeHandler);
          parameterSelectorChangeHandler = null;
        }
      }
    };

    /**
     * Formats date string or timestamp to readable format
     * @param {string|number} date - ISO string, Unix timestamp, or formatted date
     * @returns {string}
     */
    const formatDate = (date) => {
      if (!date) return '';

      try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return date; // Return as-is if invalid

        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }); // e.g., "Jan 15, 2024"
      } catch (err) {
        return date; // Return original on error
      }
    };

    /**
     * Determines if a value should be highlighted as out-of-range
     * @param {Object} row - Data row
     * @returns {boolean}
     */
    const shouldHighlightOutOfRange = (row) => {
      // Use database flag if available
      if (row.is_value_out_of_range !== undefined) {
        return row.is_value_out_of_range;
      }

      // Fallback: compute client-side
      const value = parseFloat(row.value);
      if (isNaN(value)) return false;

      const lower = parseFloat(row.reference_lower);
      const upper = parseFloat(row.reference_upper);

      if (!isNaN(lower) && value < lower) return true;
      if (!isNaN(upper) && value > upper) return true;

      return false;
    };

    /**
     * Escapes HTML special characters to prevent XSS attacks
     * @param {string} str - String to escape
     * @returns {string} - HTML-safe string
     */
    const escapeHtml = (str) => {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    };

    /**
     * Display error message in data results section
     * @param {string} message - Error message to display
     */
    const showDataError = (message) => {
      if (dataResultsTbody && dataResultsSection && rowCountMsg) {
        dataResultsTbody.innerHTML = `<tr><td colspan="4" class="error-message">${escapeHtml(message)}</td></tr>`;
        rowCountMsg.textContent = '';
        dataResultsSection.style.display = 'block';
      }
    };

    /**
     * Renders tabular results for data_query type queries
     * @param {Object} payload - SQL generation result with execution data
     * @param {Object} payload.execution - Execution results
     * @param {Array} payload.execution.rows - Result rows
     * @param {number} payload.execution.rowCount - Number of rows returned
     * @param {number} payload.execution.totalRowCount - Total rows available (before LIMIT)
     */
    const renderDataQueryResults = (payload) => {
      if (!dataResultsSection || !dataResultsTbody || !rowCountMsg) {
        console.error('[renderDataQueryResults] Required DOM elements not found');
        return;
      }

      // Clear previous results
      dataResultsTbody.innerHTML = '';

      // Validate execution data
      if (!payload.execution || !payload.execution.rows) {
        showDataError('No execution results available');
        return;
      }

      const { rows, rowCount, totalRowCount } = payload.execution;

      // Handle empty results
      if (rowCount === 0) {
        dataResultsTbody.innerHTML = '<tr><td colspan="4" class="no-data">No data found for your query</td></tr>';
        rowCountMsg.textContent = 'No results found';
        dataResultsSection.style.display = 'block';
        return;
      }

      // Validate required column aliases (prevent broken UI)
      if (rowCount > 0) {
        const firstRow = rows[0];
        const requiredColumns = ['date', 'value', 'unit', 'reference_interval'];
        const missingColumns = requiredColumns.filter(col => !(col in firstRow));

        if (missingColumns.length > 0) {
          console.error('[renderDataQueryResults] Missing required columns:', missingColumns, 'requestId:', payload.metadata?.request_id);
          showDataError(`Query results are missing required columns: ${missingColumns.join(', ')}. Please try rephrasing your question.`);
          return;
        }
      }

      // Render row count message
      if (totalRowCount && totalRowCount > rowCount) {
        rowCountMsg.textContent = `Showing ${rowCount} of ${totalRowCount} total rows`;
      } else {
        rowCountMsg.textContent = `Found ${rowCount} row${rowCount !== 1 ? 's' : ''}`;
      }

      // Render table rows
      rows.forEach(row => {
        const tr = document.createElement('tr');

        // Date column
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(row.date) || 'N/A';
        tr.appendChild(dateCell);

        // Value column (with out-of-range highlighting)
        const valueCell = document.createElement('td');
        valueCell.textContent = row.value !== null ? row.value : 'N/A';

        // Apply out-of-range styling if applicable
        if (shouldHighlightOutOfRange(row)) {
          valueCell.setAttribute('data-out-of-range', 'true');
        }
        tr.appendChild(valueCell);

        // Unit column
        const unitCell = document.createElement('td');
        unitCell.textContent = row.unit || '';
        tr.appendChild(unitCell);

        // Reference Interval column
        const refCell = document.createElement('td');
        refCell.textContent = row.reference_interval || 'Unavailable';
        tr.appendChild(refCell);

        dataResultsTbody.appendChild(tr);
      });

      dataResultsSection.style.display = 'block';
    };

    const renderSqlResult = (payload) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      // Cleanup previous chart if exists
      if (currentChart && window.plotRenderer) {
        window.plotRenderer.destroyChart(currentChart);
        currentChart = null;
      }

      const parameterListEl = document.getElementById('parameter-list');
      if (parameterListEl && parameterSelectorChangeHandler) {
        parameterListEl.removeEventListener('change', parameterSelectorChangeHandler);
        parameterSelectorChangeHandler = null;
      }

      // Hide plot container and wrapper by default
      const plotContainer = document.getElementById('plot-container');
      const visualizationContainer = document.getElementById('plot-visualization-container');
      if (visualizationContainer) {
        visualizationContainer.hidden = true;
      }
      if (plotContainer) {
        plotContainer.hidden = true;
      }
      const plotResetBtn = document.getElementById('plot-reset-btn');
      if (plotResetBtn) {
        plotResetBtn.hidden = true;
        plotResetBtn.disabled = true;
        plotResetBtn.onclick = null;
      }

      // Hide/reset data results section
      if (dataResultsSection) {
        dataResultsSection.style.display = 'none';
      }
      if (dataResultsTbody) {
        dataResultsTbody.innerHTML = '';
      }
      if (rowCountMsg) {
        rowCountMsg.textContent = '';
      }

      // Determine query type (handle missing field for single-shot mode)
      const queryType = payload.query_type || 'data_query';

      // Log warning if query_type is missing
      if (!payload.query_type) {
        console.warn('[renderSqlResult] query_type field missing, defaulting to data_query. This may indicate agentic mode is disabled.');
      }

      // Route based on query type
      if (queryType === 'plot_query') {
        // Plot query: use existing plot rendering logic
        if (dataResultsSection) {
          dataResultsSection.style.display = 'none';
        }
        setTimeout(() => {
          if (window.plotRenderer) {
            renderPlotVisualization(payload).catch(err => {
              console.error('[app] Plot rendering failed:', err);
            });
          } else {
            console.error('[app] plotRenderer not available');
          }
        }, 100);
      } else {
        // Data query: render tabular results
        renderDataQueryResults(payload);
      }
    };

    const performSqlGeneration = async ({ regenerate = false } = {}) => {
      if (isGeneratingSql) {
        return;
      }

      const inputValue = regenerate ? lastQuestion : normalizeInput(sqlQuestionInput.value);

      if (!isNonEmptyString(inputValue)) {
        setSqlStatus('Enter a question in English or Russian.', 'error');
        return;
      }

      if (inputValue.length > 500) {
        setSqlStatus('Questions are limited to 500 characters.', 'error');
        return;
      }

      if (!regenerate) {
        lastQuestion = inputValue;
      }

      if (!regenerate && sqlQuestionInput.value !== inputValue) {
        sqlQuestionInput.value = inputValue;
      }

      setSqlStatus('Generating SQL…', 'loading');
      setSqlLoadingState(true);

      try {
        // Step 1: Initiate SQL generation job
        const response = await fetch('/api/sql-generator', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question: inputValue }),
        });

        const payload = await response.json().catch(() => null);

        // Handle immediate errors (validation, etc.)
        if (!response.ok) {
          const errorMessage = payload && payload.error && isNonEmptyString(payload.error.message)
            ? payload.error.message
            : payload && isNonEmptyString(payload.error)
              ? payload.error
              : 'Unable to start SQL generation.';
          throw new Error(errorMessage);
        }

        // Step 2: Get jobId from response
        const jobId = payload?.jobId;
        if (!jobId) {
          throw new Error('No job ID returned from server.');
        }

        console.log(`[sqlGenerator] Job created: ${jobId}, starting polling...`);

        // Step 3: Poll for job completion
        const pollInterval = 1000; // Poll every 1 second
        const maxAttempts = 180; // Max 3 minutes (180 seconds)
        let attempts = 0;

        const pollJob = async () => {
          attempts++;

          if (attempts > maxAttempts) {
            throw new Error('SQL generation timed out. Please try again.');
          }

          const jobResponse = await fetch(`/api/sql-generator/jobs/${jobId}`);
          const jobStatus = await jobResponse.json().catch(() => null);

          if (!jobResponse.ok || !jobStatus) {
            throw new Error('Failed to check job status.');
          }

          console.log(`[sqlGenerator] Job ${jobId} status: ${jobStatus.status} (attempt ${attempts})`);

          if (jobStatus.status === 'completed') {
            // Success! Render the result
            const result = jobStatus.result;

            if (!result || result.ok === false) {
              // Handle validation failure
              const errorMessage = result?.error && isNonEmptyString(result.error.message)
                ? result.error.message
                : 'Generated SQL failed validation.';
              const hint = result?.details && isNonEmptyString(result.details.hint)
                ? ` ${result.details.hint}`
                : '';
              throw new Error(`${errorMessage}${hint}`);
            }

            lastQuestion = result && isNonEmptyString(result.question)
              ? result.question
              : inputValue;

            renderSqlResult(result);

            // Set status message based on query type
            const queryType = result.query_type || 'data_query';
            if (queryType === 'plot_query') {
              setSqlStatus('Visualization generated successfully.', 'success');
            } else if (queryType === 'data_query') {
              setSqlStatus('Query results displayed below.', 'success');
            } else {
              setSqlStatus('Query completed successfully.', 'success');
            }
            return; // Done!

          } else if (jobStatus.status === 'failed') {
            // Job failed
            const errorMessage = jobStatus.error || 'SQL generation failed.';
            throw new Error(errorMessage);

          } else {
            // Still processing, poll again after delay
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                pollJob().then(resolve).catch(reject);
              }, pollInterval);
            });
          }
        };

        // Start polling
        await pollJob();

      } catch (error) {
        setSqlStatus(error?.message || 'Unable to generate SQL right now.', 'error');
      } finally {
        setSqlLoadingState(false);
      }
    };

    sqlGenerateBtn.addEventListener('click', () => performSqlGeneration({ regenerate: false }));

    sqlQuestionInput.addEventListener('keydown', (event) => {
      if (!event) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        performSqlGeneration({ regenerate: false });
      }
    });
  }

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

          setRawOutput(
            typeof persistedPayload.raw_model_output === 'string'
              ? persistedPayload.raw_model_output
              : '',
          );
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
