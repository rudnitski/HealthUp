(() => {
  const fileInput = document.querySelector('#file-input');
  const fileMessageEl = document.querySelector('#file-message');
  const analyzeBtn = document.querySelector('#analyze-btn');
  const resultEl = document.querySelector('#analysis-result');
  const detailsEl = document.querySelector('#analysis-details');
  const rawOutputEl = document.querySelector('#analysis-raw');

  if (!fileInput || !fileMessageEl || !analyzeBtn || !resultEl || !detailsEl || !rawOutputEl) {
    return;
  }

  const defaultButtonText = analyzeBtn.textContent;
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

  const resetAnalyzeButton = () => {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = defaultButtonText;
  };

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    updateFileMessage(file ? file.name : '');
    hideDetails();
    setRawOutput('');

    if (file) {
      setResultMessage('Ready to analyze. Click "Upload & Analyze" when you\'re ready.', 'info');
    } else {
      setResultMessage('');
    }
  });

  fileInput.addEventListener('input', () => {
    const [file] = fileInput.files || [];
    if (!file) {
      updateFileMessage('');
      hideDetails();
      setRawOutput('');
      setResultMessage('');
    }
  });

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
    const maxAttempts = 120; // 120 * 2s = 4 minutes max
    const pollInterval = 2000; // 2 seconds

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

  analyzeBtn.addEventListener('click', async () => {
    const [file] = fileInput.files || [];

    if (!file) {
      setResultMessage('Select a file before analyzing.', 'error');
      hideDetails();
      return;
    }

    const analysisStartedAt = performance.now();

    const formData = new FormData();
    formData.append('analysisFile', file, file.name || 'upload');

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    hideDetails();
    setResultMessage('Uploading your lab report…', 'loading');
    renderProgress([{ id: 'uploaded', status: 'in_progress' }]);

    try {
      // Step 1: Upload file and get job ID
      const uploadResponse = await fetch('/api/analyze-labs', {
        method: 'POST',
        body: formData,
      });

      const uploadPayload = await uploadResponse.json().catch(() => ({}));

      if (!uploadResponse.ok) {
        const errorMessage = typeof uploadPayload.error === 'string' && uploadPayload.error
          ? uploadPayload.error
          : 'Upload failed. Please try again later.';
        setResultMessage(errorMessage, 'error');
        setRawOutput('');
        hideDetails();
        return;
      }

      // Check for job ID (async processing)
      if (uploadResponse.status === 202 && uploadPayload.job_id) {
        const jobId = uploadPayload.job_id;

        setResultMessage('Analyzing your lab report…', 'loading');
        renderProgress([{ id: 'uploaded', status: 'completed' }]);

        // Step 2: Poll for job completion
        const result = await pollJobStatus(jobId, (progress, message, status) => {
          // Update progress message
          if (message) {
            setResultMessage(message, 'loading');
          }

          // Update progress UI with mapped steps
          const mappedSteps = mapProgressToSteps(progress, status);
          renderProgress(mappedSteps);
        });

        // Step 3: Display results
        const elapsedMs = performance.now() - analysisStartedAt;
        let persistedPayload = null;

        if (typeof result.report_id === 'string' && result.report_id) {
          setResultMessage('Loading results…', 'loading');
          persistedPayload = await fetchPersistedReport(result.report_id);
        }

        const displayPayload = persistedPayload || result || {};

        renderDetails(displayPayload, elapsedMs);

        // Mark all steps as completed
        renderProgress(mapProgressToSteps(100, 'completed'));

        const parametersForMessage = Array.isArray(displayPayload.parameters)
          ? displayPayload.parameters
          : [];
        const total = parametersForMessage.length;

        let statusMessage;
        let statusState;

        if (total > 0) {
          statusMessage = `Extracted ${total} parameter${total === 1 ? '' : 's'}.`;
          statusState = 'success';
        } else {
          statusMessage = 'No parameters detected.';
          statusState = 'info';
        }

        setResultMessage(statusMessage, statusState);
        setRawOutput(
          typeof displayPayload.raw_model_output === 'string'
            ? displayPayload.raw_model_output
            : '',
        );
      } else {
        // Legacy synchronous response (backwards compatibility)
        renderProgress(uploadPayload.progress || []);

        const elapsedMs = performance.now() - analysisStartedAt;
        let persistedPayload = null;

        if (typeof uploadPayload.report_id === 'string' && uploadPayload.report_id) {
          setResultMessage('Saving your results…', 'loading');
          persistedPayload = await fetchPersistedReport(uploadPayload.report_id);
        }

        const displayPayload = persistedPayload || uploadPayload || {};

        renderDetails(displayPayload, elapsedMs);
        renderProgress((uploadPayload && uploadPayload.progress) || []);

        const parametersForMessage = Array.isArray(displayPayload.parameters)
          ? displayPayload.parameters
          : [];
        const total = parametersForMessage.length;

        let statusMessage;
        let statusState;

        if (total > 0) {
          statusMessage = `Extracted ${total} parameter${total === 1 ? '' : 's'}.`;
          statusState = 'success';
        } else {
          statusMessage = 'No parameters detected.';
          statusState = 'info';
        }

        setResultMessage(statusMessage, statusState);
        setRawOutput(
          typeof displayPayload.raw_model_output === 'string'
            ? displayPayload.raw_model_output
            : '',
        );
      }
    } catch (error) {
      setResultMessage(error.message || 'Unable to analyze right now. Please try again later.', 'error');
      setRawOutput('');
      hideDetails();
    } finally {
      resetAnalyzeButton();
    }
  });

  const sqlQuestionInput = document.querySelector('#sql-question');
  const sqlGenerateBtn = document.querySelector('#sql-generate-btn');
  const sqlRegenerateBtn = document.querySelector('#sql-regenerate-btn');
  const sqlCopyBtn = document.querySelector('#sql-copy-btn');
  const sqlStatusEl = document.querySelector('#sql-status');
  const sqlResultEl = document.querySelector('#sql-result');
  const sqlOutputEl = document.querySelector('#sql-output');
  const sqlModelEl = document.querySelector('#sql-model');
  const sqlConfidenceEl = document.querySelector('#sql-confidence');
  const sqlGeneratedAtEl = document.querySelector('#sql-generated-at');
  const sqlWarningsEl = document.querySelector('#sql-warnings');
  const sqlNotesEl = document.querySelector('#sql-notes');
  const sqlCopyFeedbackEl = document.querySelector('#sql-copy-feedback');

  if (
    sqlQuestionInput
    && sqlGenerateBtn
    && sqlCopyBtn
    && sqlResultEl
    && sqlOutputEl
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

      if (sqlRegenerateBtn) {
        sqlRegenerateBtn.disabled = isLoading;
      }

      if (sqlCopyBtn) {
        sqlCopyBtn.disabled = isLoading;
      }
    };

    const renderWarnings = (warnings) => {
      if (!sqlWarningsEl) {
        return;
      }

      if (!Array.isArray(warnings) || warnings.length === 0) {
        sqlWarningsEl.hidden = true;
        sqlWarningsEl.replaceChildren();
        return;
      }

      const fragment = document.createDocumentFragment();
      let appended = 0;
      warnings.forEach((warning) => {
        if (!isNonEmptyString(warning)) {
          return;
        }
        const item = document.createElement('li');
        item.textContent = warning.trim();
        fragment.append(item);
        appended += 1;
      });

      if (appended === 0) {
        sqlWarningsEl.hidden = true;
        sqlWarningsEl.replaceChildren();
        return;
      }

      sqlWarningsEl.replaceChildren(fragment);
      sqlWarningsEl.hidden = false;
    };

    const renderNotes = (notes) => {
      if (!sqlNotesEl) {
        return;
      }

      if (!isNonEmptyString(notes)) {
        sqlNotesEl.hidden = true;
        sqlNotesEl.textContent = '';
        return;
      }

      sqlNotesEl.hidden = false;
      sqlNotesEl.textContent = notes.trim();
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

      if (sqlOutputEl) {
        const sqlText = isNonEmptyString(payload.sql) ? payload.sql.trim() : '';
        sqlOutputEl.textContent = sqlText;
      }

      if (sqlResultEl) {
        sqlResultEl.hidden = !isNonEmptyString(payload.sql);
      }

      // Handle new metadata structure (PRD v0.9.2)
      if (sqlModelEl) {
        const model = payload.metadata && isNonEmptyString(payload.metadata.model)
          ? payload.metadata.model
          : payload.model; // Fallback to old format
        sqlModelEl.textContent = isNonEmptyString(model) ? `Model: ${model}` : '';
      }

      if (sqlConfidenceEl) {
        // Old format compatibility
        if (typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)) {
          const clamped = Math.max(0, Math.min(payload.confidence, 1));
          const percent = Math.round(clamped * 100);
          sqlConfidenceEl.textContent = `Confidence: ${percent}%`;
        } else {
          sqlConfidenceEl.textContent = '';
        }
      }

      if (sqlGeneratedAtEl) {
        if (isNonEmptyString(payload.generated_at)) {
          const generatedDate = new Date(payload.generated_at);
          if (!Number.isNaN(generatedDate.getTime())) {
            sqlGeneratedAtEl.textContent = generatedDate.toLocaleString();
          } else {
            sqlGeneratedAtEl.textContent = '';
          }
        } else {
          sqlGeneratedAtEl.textContent = '';
        }
      }

      // Display explanation (new in PRD v0.9.2)
      if (isNonEmptyString(payload.explanation)) {
        renderNotes(payload.explanation);
      } else {
        renderNotes(payload.notes); // Fallback to old format
      }

      // Warnings are deprecated in new format, but keep for compatibility
      renderWarnings(payload.warnings);

      if (sqlRegenerateBtn) {
        sqlRegenerateBtn.hidden = false;
      }

      if (sqlCopyFeedbackEl) {
        sqlCopyFeedbackEl.hidden = true;
        sqlCopyFeedbackEl.textContent = 'Copied!';
      }

      // Check if this is a plot query (render plot after all other UI updates)
      const isPlotQuery = payload.query_type === 'plot_query';
      if (isPlotQuery) {
        // Use setTimeout to ensure DOM is updated before rendering plot
        setTimeout(() => {
          if (window.plotRenderer) {
            renderPlotVisualization(payload).catch(err => {
              console.error('[app] Plot rendering failed:', err);
            });
          } else {
            console.error('[app] plotRenderer not available');
          }
        }, 100);
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
        const response = await fetch('/api/sql-generator', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question: inputValue }),
        });

        const payload = await response.json().catch(() => null);

        // Handle validation failure (HTTP 422) with structured error
        if (response.status === 422 && payload && payload.ok === false) {
          const errorDetails = payload.error && isNonEmptyString(payload.error.message)
            ? payload.error.message
            : 'Generated SQL failed validation.';
          const hint = payload.details && isNonEmptyString(payload.details.hint)
            ? ` ${payload.details.hint}`
            : '';
          throw new Error(`${errorDetails}${hint}`);
        }

        if (!response.ok) {
          const errorMessage = payload && payload.error && isNonEmptyString(payload.error.message)
            ? payload.error.message
            : payload && isNonEmptyString(payload.error)
              ? payload.error
              : 'Unable to generate SQL right now.';
          throw new Error(errorMessage);
        }

        // New format returns ok: true/false
        if (payload.ok === false) {
          const errorMessage = payload.error && isNonEmptyString(payload.error.message)
            ? payload.error.message
            : 'Unable to generate SQL right now.';
          throw new Error(errorMessage);
        }

        lastQuestion = payload && isNonEmptyString(payload.question)
          ? payload.question
          : inputValue;

        renderSqlResult(payload);
        setSqlStatus('SQL generated. Review before using externally.', 'success');
      } catch (error) {
        setSqlStatus(error?.message || 'Unable to generate SQL right now.', 'error');
      } finally {
        setSqlLoadingState(false);
      }
    };

    sqlGenerateBtn.addEventListener('click', () => performSqlGeneration({ regenerate: false }));

    if (sqlRegenerateBtn) {
      sqlRegenerateBtn.addEventListener('click', () => {
        if (!isNonEmptyString(lastQuestion)) {
          setSqlStatus('Generate a query before requesting a new version.', 'error');
          return;
        }
        performSqlGeneration({ regenerate: true });
      });
    }

    sqlQuestionInput.addEventListener('keydown', (event) => {
      if (!event) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        performSqlGeneration({ regenerate: false });
      }
    });

    if (sqlCopyBtn) {
      sqlCopyBtn.addEventListener('click', async () => {
        if (!sqlOutputEl || !isNonEmptyString(sqlOutputEl.textContent)) {
          return;
        }

        const sqlText = sqlOutputEl.textContent;

        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(sqlText);
          } else {
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = sqlText;
            tempTextArea.setAttribute('readonly', '');
            tempTextArea.style.position = 'absolute';
            tempTextArea.style.left = '-9999px';
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextArea);
          }

          if (sqlCopyFeedbackEl) {
            sqlCopyFeedbackEl.hidden = false;
            sqlCopyFeedbackEl.textContent = 'Copied!';

            if (copyFeedbackTimeout) {
              clearTimeout(copyFeedbackTimeout);
            }

            copyFeedbackTimeout = setTimeout(() => {
              if (sqlCopyFeedbackEl) {
                sqlCopyFeedbackEl.hidden = true;
              }
            }, 2000);
          }
        } catch (_copyError) {
          setSqlStatus('Unable to copy to clipboard. Copy manually if needed.', 'error');
        }
      });
    }
  }
})();
