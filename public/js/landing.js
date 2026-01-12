// public/js/landing.js
// PRD v5.0: Landing page state machine and logic

(async () => {
  // Wait for auth before any API calls
  const isAuthenticated = await window.authReady;
  if (!isAuthenticated) {
    return;
  }

  // State elements
  const states = {
    welcome: document.getElementById('state-welcome'),
    processing: document.getElementById('state-processing'),
    generating: document.getElementById('state-generating'),
    insight: document.getElementById('state-insight'),
    error: document.getElementById('state-error')
  };

  // UI elements
  const uploadZone = document.getElementById('upload-zone');
  const uploadButton = document.getElementById('upload-button');
  const fileInput = document.getElementById('file-input');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressMessage = document.getElementById('progress-message');
  const fileList = document.getElementById('file-list');
  const markersCount = document.getElementById('markers-count');
  const insightText = document.getElementById('insight-text');
  const suggestionsGrid = document.getElementById('suggestions-grid');
  const errorMessage = document.getElementById('error-message');
  const retryButton = document.getElementById('retry-button');
  const skipButton = document.getElementById('skip-button');

  // State tracking
  let completedReportIds = [];
  let completedPatientId = null;
  let insightRetryCount = 0;
  const MAX_INSIGHT_RETRIES = 3;
  const fileItemRefs = new Map(); // Map<filename, HTMLElement> for safe DOM access

  // Progress message mapping
  function getDisplayMessage(progress, progressMessage) {
    const patterns = [
      { match: /^File uploaded/i, display: 'Uploading...' },
      { match: /^Processing|^Preparing/i, display: 'Preparing your report...' },
      { match: /^Analyzing/i, display: 'Extracting health markers...' },
      { match: /^Parsing|^AI analysis/i, display: 'Processing results...' },
      { match: /^Saving|^Results saved/i, display: 'Saving your data...' },
      { match: /^Normalizing|^Mapping|^Analyte/i, display: 'Finalizing...' },
      { match: /^Completed$/i, display: '✓ Done' },
    ];

    for (const { match, display } of patterns) {
      if (match.test(progressMessage)) return display;
    }

    return progress >= 100 ? '✓ Done' : 'Processing...';
  }

  // State management
  function showState(stateName) {
    Object.entries(states).forEach(([name, el]) => {
      if (el) el.hidden = name !== stateName;
    });
  }

  // Drag and drop handlers
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  });

  uploadZone.addEventListener('click', () => {
    fileInput.click();
  });

  uploadButton.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFiles(fileInput.files);
    }
  });

  retryButton.addEventListener('click', () => {
    insightRetryCount = 0;
    showState('welcome');
    fileInput.value = '';
  });

  skipButton.addEventListener('click', () => {
    window.location.href = '/index.html#assistant';
  });

  async function handleFiles(files) {
    // Validate files
    const validFiles = Array.from(files).filter(file => {
      const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic'];
      const validExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.heic'];
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      return validTypes.includes(file.type) || validExtensions.includes(ext);
    });

    if (validFiles.length === 0) {
      showError('Please upload PDF or image files (PNG, JPEG, HEIC).');
      return;
    }

    if (validFiles.length > 20) {
      showError('Maximum 20 files allowed per upload.');
      return;
    }

    // Check total size
    const totalSize = validFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 100 * 1024 * 1024) {
      showError('Total file size exceeds 100MB limit.');
      return;
    }

    // Switch to processing state
    showState('processing');
    renderFileList(validFiles);

    try {
      // Upload files
      const formData = new FormData();
      validFiles.forEach(file => {
        formData.append('analysisFile', file);
      });

      const uploadResponse = await fetch('/api/analyze-labs/batch', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json().catch(() => ({}));
        throw new Error(error.error || 'Upload failed');
      }

      const { batch_id } = await uploadResponse.json();

      // Poll for completion
      await pollBatchStatus(batch_id, validFiles.length);

    } catch (error) {
      console.error('[Landing] Upload failed:', error);
      showError(error.message || 'Upload failed. Please try again.');
    }
  }

  function renderFileList(files) {
    // Clear previous refs and DOM
    fileItemRefs.clear();
    fileList.innerHTML = '';

    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-item-name';
      nameSpan.textContent = file.name; // Safe: textContent prevents XSS

      const statusSpan = document.createElement('span');
      statusSpan.className = 'file-item-status';
      statusSpan.textContent = 'Pending';

      item.appendChild(nameSpan);
      item.appendChild(statusSpan);
      fileList.appendChild(item);

      // Store reference by filename (avoids CSS selector injection)
      fileItemRefs.set(file.name, item);
    });
  }

  function updateFileStatus(filename, status, isComplete, isError) {
    // Use reference map instead of querySelector (avoids selector injection)
    const item = fileItemRefs.get(filename);
    if (item) {
      const statusEl = item.querySelector('.file-item-status');
      statusEl.textContent = status;
      statusEl.classList.toggle('complete', isComplete);
      statusEl.classList.toggle('error', isError);
    }
  }

  async function pollBatchStatus(batchId, totalFiles) {
    const POLL_INTERVAL = 2000;
    let attempts = 0;
    const MAX_ATTEMPTS = 300; // 10 minutes max

    while (attempts < MAX_ATTEMPTS) {
      try {
        const response = await fetch(`/api/analyze-labs/batches/${batchId}`, {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error('Failed to check batch status');
        }

        const data = await response.json();
        const jobs = data.jobs || [];

        // Update progress
        const completedCount = jobs.filter(j => j.status === 'completed' || j.status === 'failed').length;
        const avgProgress = jobs.length > 0
          ? jobs.reduce((sum, j) => sum + (j.progress || 0), 0) / jobs.length
          : 0;

        progressBarFill.style.width = `${avgProgress}%`;

        // Find the job currently processing for message
        const processingJob = jobs.find(j => j.status === 'processing');
        if (processingJob) {
          progressMessage.textContent = getDisplayMessage(processingJob.progress, processingJob.progress_message);
        } else if (completedCount < jobs.length) {
          progressMessage.textContent = `${completedCount} of ${jobs.length} complete`;
        }

        // Update file statuses
        jobs.forEach(job => {
          if (job.status === 'completed') {
            updateFileStatus(job.filename, '✓', true, false);
          } else if (job.status === 'failed') {
            updateFileStatus(job.filename, '✗ Failed', false, true);
          } else if (job.status === 'processing') {
            updateFileStatus(job.filename, 'Processing...', false, false);
          }
        });

        // Check if all done
        const allDone = jobs.every(j => j.status === 'completed' || j.status === 'failed');

        if (allDone) {
          // Collect successful jobs
          const successfulJobs = jobs.filter(j => j.status === 'completed');

          if (successfulJobs.length === 0) {
            showError('All uploads failed. Please try again with different files.');
            return;
          }

          // Get patient IDs and filter to primary patient
          const patientIds = [...new Set(successfulJobs.map(j => j.patient_id).filter(Boolean))];

          // Guard: If no patient_id found in any successful job, show error
          if (patientIds.length === 0) {
            showError('No patient information found in uploaded reports. Please ensure your lab reports contain patient details.');
            return;
          }

          completedPatientId = patientIds[0];

          // Filter to only primary patient's reports
          const primaryPatientJobs = successfulJobs.filter(j => j.patient_id === completedPatientId);
          completedReportIds = primaryPatientJobs.map(j => j.report_id).filter(Boolean);

          if (patientIds.length > 1) {
            console.warn('[Landing] Multiple patients detected. Using primary patient:', completedPatientId);
          }

          // Count parameters from PRIMARY PATIENT's jobs only (matches insight generation)
          const totalParams = primaryPatientJobs.reduce((sum, j) => sum + (j.parameters?.length || 0), 0);

          // Move to generating state
          markersCount.textContent = `${totalParams} health markers extracted`;
          showState('generating');

          // Generate insight
          await generateInsight();
          return;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        attempts++;

      } catch (error) {
        console.error('[Landing] Poll error:', error);
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        attempts++;
      }
    }

    showError('Processing took too long. Please try again.');
  }

  async function generateInsight() {
    try {
      const response = await fetch('/api/onboarding/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ report_ids: completedReportIds })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.retryable && insightRetryCount < MAX_INSIGHT_RETRIES) {
          insightRetryCount++;
          console.log(`[Landing] Insight retry ${insightRetryCount}/${MAX_INSIGHT_RETRIES}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return generateInsight();
        }
        throw new Error(error.error || 'Failed to generate insight');
      }

      const data = await response.json();
      displayInsight(data);

    } catch (error) {
      console.error('[Landing] Insight generation failed:', error);

      if (insightRetryCount >= MAX_INSIGHT_RETRIES) {
        // Show fallback insight
        displayFallbackInsight();
      } else {
        showError('We couldn\'t generate your personalized insight.', true);
      }
    }
  }

  function displayInsight(data) {
    // Use textContent to prevent XSS
    insightText.textContent = data.insight;

    // Render suggestions safely
    suggestionsGrid.innerHTML = '';
    data.suggestions.forEach((suggestion, index) => {
      const button = document.createElement('button');
      button.className = 'suggestion-button';
      button.textContent = suggestion.label; // textContent for XSS safety
      button.addEventListener('click', () => {
        proceedToChat(suggestion, data);
      });
      suggestionsGrid.appendChild(button);
    });

    showState('insight');
  }

  function displayFallbackInsight() {
    const fallbackData = {
      insight: `We processed ${completedReportIds.length} lab report(s) with health markers. You can now ask questions about your results.`,
      suggestions: [
        { label: 'Summarize my results', query: 'Can you give me a summary of my lab results?' },
        { label: 'What\'s out of range?', query: 'Which of my lab values are outside the normal range?' },
        { label: 'Health recommendations', query: 'Based on my lab results, what health recommendations do you have?' }
      ],
      patient_id: completedPatientId,
      patient_name: null
    };

    displayInsight(fallbackData);
    skipButton.hidden = false;
  }

  function proceedToChat(selectedSuggestion, insightResponse) {
    const context = {
      insight: insightResponse.insight,
      selected_query: selectedSuggestion.query,
      report_ids: completedReportIds,
      patient_id: insightResponse.patient_id || completedPatientId,
      patient_name: insightResponse.patient_name,
      lab_data: insightResponse.lab_data || []  // PRD v5.0: Include lab data for system prompt
    };

    sessionStorage.setItem('onboarding_context', JSON.stringify(context));
    window.location.href = '/index.html#assistant';
  }

  function showError(message, showSkip = false) {
    errorMessage.textContent = message;
    skipButton.hidden = !showSkip;
    showState('error');
  }
})();
