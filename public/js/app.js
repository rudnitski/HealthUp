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
    { id: 'completed', label: 'Completed' },
  ];
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

  const formatReferenceInterval = (referenceInterval) => {
    if (!referenceInterval || typeof referenceInterval !== 'object') {
      return '';
    }

    const text = isNonEmptyString(referenceInterval.text) ? referenceInterval.text.trim() : '';
    if (text) {
      return text;
    }

    const lower = formatNumber(referenceInterval.lower);
    const upper = formatNumber(referenceInterval.upper);

    if (lower && upper) {
      return `${lower} - ${upper}`;
    }

    if (lower) {
      return `>= ${lower}`;
    }

    if (upper) {
      return `<= ${upper}`;
    }

    return '';
  };

  const formatOutOfRange = (value) => {
    switch (value) {
      case 'above':
        return 'Above interval';
      case 'below':
        return 'Below interval';
      case 'flagged_by_lab':
        return 'Flagged by lab';
      case 'within':
        return 'Within interval';
      case 'unknown':
      default:
        return 'Unknown';
    }
  };

  const formatSecondaryDates = (secondaryDates) => {
    if (!Array.isArray(secondaryDates) || !secondaryDates.length) {
      return '';
    }

    return secondaryDates
      .map((entry) => {
        const type = isNonEmptyString(entry.type) ? entry.type.trim() : 'date';
        const value = isNonEmptyString(entry.value) ? entry.value.trim() : 'unknown';
        if (isNonEmptyString(entry.source_text)) {
          return `${type}: ${value} (${entry.source_text.trim()})`;
        }
        return `${type}: ${value}`;
      })
      .join('; ');
  };

  const renderDetails = (payload) => {
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

    const statusLabel = isNonEmptyString(payload.status)
      ? payload.status.replace(/_/g, ' ')
      : 'needs review';
    addRow('Extraction Status', statusLabel, { isMissing: payload.status === 'failed' });

    const patientName = isNonEmptyString(payload.patient_name)
      ? payload.patient_name.trim()
      : 'Missing';
    addRow('Patient Name', patientName, { isMissing: !isNonEmptyString(payload.patient_name) });

    const dateOfBirth = isNonEmptyString(payload.date_of_birth)
      ? payload.date_of_birth.trim()
      : 'Missing';
    addRow('Date of Birth', dateOfBirth, { isMissing: !isNonEmptyString(payload.date_of_birth) });

    const labDates = payload.lab_dates && typeof payload.lab_dates === 'object' ? payload.lab_dates : {};
    const primaryTestDate = isNonEmptyString(labDates.primary_test_date)
      ? labDates.primary_test_date.trim()
      : 'Missing';
    const primarySource = isNonEmptyString(labDates.primary_test_date_source)
      ? labDates.primary_test_date_source.trim()
      : 'unknown';
    addRow('Primary Test Date', primaryTestDate, {
      isMissing: !isNonEmptyString(labDates.primary_test_date),
    });
    addRow('Primary Date Source', primarySource, {
      isMissing: !isNonEmptyString(labDates.primary_test_date_source),
      isSubRow: true,
    });

    const secondaryDatesLabel = formatSecondaryDates(labDates.secondary_dates);
    if (secondaryDatesLabel) {
      addRow('Additional Dates', secondaryDatesLabel, { isSubRow: true });
    }

    const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const totalParameters = typeof summary.parameters_total === 'number' ? summary.parameters_total : 0;
    const flaggedParameters = typeof summary.parameters_flagged === 'number' ? summary.parameters_flagged : 0;
    addRow('Parameters Detected', totalParameters.toString(), { isMissing: totalParameters === 0 });
    addRow('Parameters Flagged', flaggedParameters.toString(), { isSubRow: true });

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
          <th scope="col">Result</th>
          <th scope="col">Reference Interval</th>
          <th scope="col">Out of Range</th>
          <th scope="col">Lab Flag</th>
          <th scope="col">Specimen</th>
          <th scope="col">Page</th>
          <th scope="col">Notes</th>
          <th scope="col">Missing Fields</th>
        </tr>
      `;

      const tbody = document.createElement('tbody');

      parameters.forEach((parameter, index) => {
        const entry = parameter && typeof parameter === 'object' ? parameter : {};
        const row = document.createElement('tr');

        if (['above', 'below', 'flagged_by_lab'].includes(entry.out_of_range)) {
          row.classList.add('parameters-table__row--flagged');
        }

        const name = isNonEmptyString(entry.parameter_name)
          ? entry.parameter_name.trim()
          : `Parameter ${index + 1}`;

        const buildCell = (text, { isMissing = false } = {}) => {
          const cell = document.createElement('td');
          cell.textContent = text;
          if (isMissing) {
            cell.dataset.missing = 'true';
          }
          return cell;
        };

        row.appendChild(buildCell(name));

        const numericValue = formatNumber(entry.value);
        const textualValue = isNonEmptyString(entry.value_text) ? entry.value_text.trim() : '';
        const unit = isNonEmptyString(entry.unit) ? entry.unit.trim() : '';

        const resultParts = [];
        if (numericValue) {
          resultParts.push(unit ? `${numericValue} ${unit}` : numericValue);
        } else if (unit) {
          resultParts.push(unit);
        }
        if (textualValue) {
          resultParts.push(textualValue);
        }

        const resultCell = document.createElement('td');
        if (resultParts.length) {
          resultParts.forEach((part, partIndex) => {
            if (partIndex > 0) {
              resultCell.append(document.createElement('br'));
            }
            resultCell.append(part);
          });
        } else {
          resultCell.textContent = '--';
          resultCell.dataset.missing = 'true';
        }
        row.appendChild(resultCell);

        const referenceDisplay = formatReferenceInterval(entry.reference_interval);
        row.appendChild(buildCell(referenceDisplay || 'Missing', { isMissing: !referenceDisplay }));

        row.appendChild(buildCell(formatOutOfRange(entry.out_of_range)));

        row.appendChild(buildCell(isNonEmptyString(entry.lab_flag) ? entry.lab_flag.trim() : '--', {
          isMissing: !isNonEmptyString(entry.lab_flag),
        }));

        row.appendChild(buildCell(isNonEmptyString(entry.specimen) ? entry.specimen.trim() : '--', {
          isMissing: !isNonEmptyString(entry.specimen),
        }));

        const pageCell = document.createElement('td');
        if (typeof entry.page === 'number' && Number.isInteger(entry.page)) {
          pageCell.textContent = entry.page.toString();
        } else {
          pageCell.textContent = '--';
          pageCell.dataset.missing = 'true';
        }
        row.appendChild(pageCell);

        row.appendChild(buildCell(isNonEmptyString(entry.notes) ? entry.notes.trim() : '--', {
          isMissing: !isNonEmptyString(entry.notes),
        }));

        const missingKey = buildMissingKey(entry.parameter_name);
        const missingForParameter = missingLookup.get(missingKey);
        let missingFieldsDisplay = '';

        if (missingForParameter && missingForParameter.length) {
          const fieldsForRow = missingForParameter.shift();
          missingFieldsDisplay = fieldsForRow.join(', ');
          if (!missingForParameter.length) {
            missingLookup.delete(missingKey);
          } else {
            missingLookup.set(missingKey, missingForParameter);
          }
        }

        row.appendChild(buildCell(missingFieldsDisplay || '--', {
          isMissing: Boolean(missingFieldsDisplay),
        }));

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
    renderProgress([{ id: 'uploaded', status: 'completed' }]);

    try {
      const response = await fetch('/api/analyze-labs', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      renderProgress(payload.progress || []);

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
      renderProgress(payload.progress || []);

      const summary = payload && typeof payload === 'object' ? payload.summary : {};
      const status = typeof payload.status === 'string' ? payload.status : 'needs_review';
      const total = typeof summary?.parameters_total === 'number' ? summary.parameters_total : 0;
      const flagged = typeof summary?.parameters_flagged === 'number' ? summary.parameters_flagged : 0;

      let statusMessage = `Extracted ${total} parameter${total === 1 ? '' : 's'}`;
      if (flagged > 0) {
        statusMessage += `; ${flagged} flagged out of range`;
      }
      statusMessage += '.';

      let statusState = 'success';
      if (status === 'failed') {
        statusState = 'error';
      } else if (status === 'needs_review') {
        statusState = 'info';
      }

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
