(() => {
  const fileInput = document.querySelector('#file-input');
  const fileMessageEl = document.querySelector('#file-message');
  const analyzeBtn = document.querySelector('#analyze-btn');
  const resultEl = document.querySelector('#analysis-result');
  const rawOutputEl = document.querySelector('#analysis-raw');

  if (!fileInput || !fileMessageEl || !analyzeBtn || !resultEl || !rawOutputEl) {
    return;
  }

  const defaultButtonText = analyzeBtn.textContent;

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
    setResultMessage('');
  });

  fileInput.addEventListener('input', () => {
    // Handles browsers that emit `input` when the selection is cleared.
    const [file] = fileInput.files || [];
    if (!file) {
      updateFileMessage('');
      setResultMessage('');
    }
  });

  analyzeBtn.addEventListener('click', async () => {
    const [file] = fileInput.files || [];

    if (!file) {
      setResultMessage('Select a file before analyzing.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('analysisFile', file, file.name || 'upload');

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
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
        return;
      }

      if (payload.vitamin_d_found) {
        const valueText = typeof payload.value === 'number' && Number.isFinite(payload.value)
          ? payload.value
          : '—';
        const unitText = typeof payload.unit === 'string' && payload.unit
          ? ` ${payload.unit}`
          : '';
        setResultMessage(`Vitamin D: ${valueText}${unitText}`.trim(), 'success');
        setRawOutput(payload.raw_model_output || '');
      } else {
        setResultMessage('Vitamin D not found.', 'info');
        setRawOutput(payload.raw_model_output || '');
      }
    } catch (error) {
      setResultMessage('Unable to analyze right now. Please try again later.', 'error');
      setRawOutput('');
    } finally {
      resetAnalyzeButton();
    }
  });
})();
