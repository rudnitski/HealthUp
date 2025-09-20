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

  const formatOperator = (operator, fallback) => {
    if (!isNonEmptyString(operator)) {
      return fallback;
    }

    const trimmed = operator.trim();
    const map = {
      '>=': '≥',
      '<=': '≤',
      '>': '>',
      '<': '<',
      '=': '=',
    };

    return map[trimmed] || fallback;
  };

  const hideDetails = () => {
    detailsEl.hidden = true;
    detailsEl.replaceChildren();
  };

  const renderDetails = (payload) => {
    if (!payload || typeof payload !== 'object') {
      hideDetails();
      return;
    }

    const fragment = document.createDocumentFragment();

    const addRow = (label, value, isMissing = false, options = {}) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'result-details__row';

      if (options.isSubRow) {
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
    };

    const formatReferenceInterval = (entry) => {
      if (!entry || typeof entry !== 'object') {
        return '';
      }

      const unit = isNonEmptyString(entry.reference_interval_unit)
        ? entry.reference_interval_unit.trim()
        : '';

      const low = formatNumber(entry.reference_interval_low || entry.reference_interval_low_display);
      const high = formatNumber(entry.reference_interval_high || entry.reference_interval_high_display);

      if (low && high && (!isNonEmptyString(entry.reference_interval_low_operator) || entry.reference_interval_low_operator === '=')
        && (!isNonEmptyString(entry.reference_interval_high_operator) || entry.reference_interval_high_operator === '=')) {
        return unit ? `${low}-${high} ${unit}` : `${low}-${high}`;
      }

      const parts = [];

      if (low) {
        const symbol = formatOperator(entry.reference_interval_low_operator, '≥');
        parts.push(`${symbol} ${low}`.trim());
      }

      if (high) {
        const symbol = formatOperator(entry.reference_interval_high_operator, '≤');
        parts.push(`${symbol} ${high}`.trim());
      }

      if (!parts.length) {
        return unit ? `Reported (${unit})` : '';
      }

      const combined = parts.join(' and ');
      return unit ? `${combined} ${unit}` : combined;
    };

    const createDivider = () => {
      const divider = document.createElement('div');
      divider.className = 'result-details__divider';
      fragment.append(divider);
    };

    const patientName = isNonEmptyString(payload.patient_name)
      ? payload.patient_name.trim()
      : 'Missing';
    addRow('Patient Name', patientName, !isNonEmptyString(payload.patient_name));

    const dateOfBirth = isNonEmptyString(payload.date_of_birth)
      ? payload.date_of_birth.trim()
      : 'Missing';
    addRow('Date of Birth', dateOfBirth, !isNonEmptyString(payload.date_of_birth));

    const checkupDate = isNonEmptyString(payload.checkup_date)
      ? payload.checkup_date.trim()
      : 'Missing';
    addRow('Collection Date', checkupDate, !isNonEmptyString(payload.checkup_date));

    const vitaminResults = Array.isArray(payload.vitamin_d_results)
      ? payload.vitamin_d_results
      : [];

    if (!vitaminResults.length) {
      addRow('Vitamin D Measurements', 'No entries detected', true);
    } else {
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'result-details__section-title';
      sectionTitle.textContent = 'Vitamin D Measurements';
      fragment.append(sectionTitle);

      vitaminResults.forEach((entry, index) => {
        if (index > 0) {
          createDivider();
        }

        const result = entry && typeof entry === 'object' ? entry : {};

        const analyteLabel = isNonEmptyString(result.analyte_name)
          ? result.analyte_name.trim()
          : `Entry ${index + 1}`;

        const valueText = formatNumber(result.value);
        const unitText = isNonEmptyString(result.unit) ? result.unit.trim() : '';

        let measurementDisplay = '';
        if (valueText) {
          measurementDisplay = unitText ? `${valueText} ${unitText}` : valueText;
        } else if (unitText) {
          measurementDisplay = unitText;
        }

        const measurementMissing = !valueText;
        addRow(analyteLabel, measurementDisplay || '--', measurementMissing);

        const referenceDisplay = formatReferenceInterval(result);
        addRow('Reference Interval', referenceDisplay || 'Missing', !referenceDisplay, { isSubRow: true });
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
    // Handles browsers that emit `input` when the selection is cleared.
    const [file] = fileInput.files || [];
    if (!file) {
      updateFileMessage('');
      hideDetails();
      setRawOutput('');
      setResultMessage('');
    }
  });

  analyzeBtn.addEventListener('click', async () => {
    const [file] = fileInput.files || [];

    if (!file) {
      setResultMessage('Select a file before analyzing.', 'error');
      hideDetails();
      return;
    }

    const formData = new FormData();
    formData.append('analysisFile', file, file.name || 'upload');

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    hideDetails();
    setResultMessage('Analyzing your lab report…', 'loading');

    try {
      const response = await fetch('/api/analyze-vitamin-d', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage = typeof payload.error === 'string' && payload.error
          ? payload.error
          : 'Analysis failed. Please try again later.';
        setResultMessage(errorMessage, 'error');
        setRawOutput('');
        hideDetails();
        return;
      }

      renderDetails(payload || {});

      const vitaminResults = Array.isArray(payload.vitamin_d_results)
        ? payload.vitamin_d_results
        : [];
      const resultCount = vitaminResults.length;
      const statusMessage = resultCount > 0
        ? `Found ${resultCount} Vitamin D measurement${resultCount === 1 ? '' : 's'}.`
        : 'No Vitamin D measurements found.';
      const statusState = resultCount > 0 ? 'success' : 'info';

      setResultMessage(statusMessage, statusState);
      setRawOutput(payload.raw_model_output || '');
    } catch (error) {
      setResultMessage('Unable to analyze right now. Please try again later.', 'error');
      setRawOutput('');
      hideDetails();
    } finally {
      resetAnalyzeButton();
    }
  });
})();
