/**
 * Unified Upload and Ingestion UI
 * PRD v3.0: Handles both manual multi-file uploads and Gmail import
 */

(() => {
  // Check if we're viewing a specific report (reportId in URL)
  // If so, show old UI and exit early - app.js will handle the report loading
  const urlParams = new URLSearchParams(window.location.search);
  const reportIdParam = urlParams.get('reportId');

  if (reportIdParam) {
    const unifiedUi = document.getElementById('unified-upload-ui');
    const oldUi = document.getElementById('old-upload-ui');

    if (unifiedUi) {
      unifiedUi.style.display = 'none';
      unifiedUi.hidden = true;
    }

    if (oldUi) {
      oldUi.style.display = 'block';
      oldUi.hidden = false;
    }

    console.log('[unified-upload] Report view mode - showing old UI for reportId:', reportIdParam);
    return; // Exit early - app.js will handle loading the report
  }

  // Constants
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_BATCH_SIZE = 20;
  const MAX_AGGREGATE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_TYPES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/heic',
    'image/tiff',
    'image/tif'
  ]);
  const POLL_INTERVAL = 2000; // 2 seconds

  // State
  let selectedFiles = [];
  let currentBatchId = null;
  let pollTimer = null;
  let gmailAuthState = { enabled: false, connected: false };

  // DOM Elements - Upload Source
  const manualUploadBtn = document.getElementById('manual-upload-btn');
  const gmailImportBtn = document.getElementById('gmail-import-btn');
  const multiFileInput = document.getElementById('multi-file-input');

  // DOM Elements - Queue
  const queueSection = document.getElementById('upload-queue-section');
  const queueTbody = document.getElementById('queue-tbody');
  const startProcessingBtn = document.getElementById('start-processing-btn');
  const fileCountSpan = document.getElementById('file-count');

  // DOM Elements - Gmail
  const gmailSection = document.getElementById('gmail-section');
  const gmailAuthStatus = document.getElementById('gmail-auth-status');
  const authStatusMessage = document.getElementById('auth-status-message');
  const gmailActionBtn = document.getElementById('gmail-action-btn');
  const gmailFetchProgress = document.getElementById('gmail-fetch-progress');
  const gmailProgressFill = document.getElementById('gmail-progress-fill');
  const gmailProgressPercent = document.getElementById('gmail-progress-percent');
  const gmailStepList = document.getElementById('gmail-step-list');
  const gmailSelection = document.getElementById('gmail-selection');
  const gmailSelectionSummary = document.getElementById('gmail-selection-summary');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const downloadRecognizeBtn = document.getElementById('download-recognize-btn');
  const selectedCountSpan = document.getElementById('selected-count');
  const attachmentSelectionTbody = document.getElementById('attachment-selection-tbody');

  // DOM Elements - Progress
  const progressSection = document.getElementById('progress-section');
  const progressTbody = document.getElementById('progress-tbody');

  // DOM Elements - Results
  const resultsSection = document.getElementById('results-section');
  const successCountSpan = document.getElementById('success-count');
  const duplicateCountSpan = document.getElementById('duplicate-count');
  const duplicateStat = document.getElementById('duplicate-stat');
  const failedCountSpan = document.getElementById('failed-count');
  const resultsTbody = document.getElementById('results-tbody');

  // ======================
  // Utility Functions
  // ======================

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function getFileType(mimetype) {
    if (mimetype === 'application/pdf') return 'PDF';
    if (mimetype.startsWith('image/')) return 'Image';
    return 'File';
  }

  function showToast(message, type = 'info') {
    // Simple toast notification (you can enhance this)
    alert(message);
  }

  // ======================
  // File Selection & Validation
  // ======================

  function validateFiles(files) {
    const errors = [];
    let totalSize = 0;

    if (files.length > MAX_BATCH_SIZE) {
      errors.push(`Maximum ${MAX_BATCH_SIZE} files allowed per batch.`);
      return { valid: false, errors };
    }

    for (const file of files) {
      // Check type
      if (!ALLOWED_TYPES.has(file.type)) {
        errors.push(`"${file.name}": Unsupported file type (${file.type})`);
      }

      // Check individual size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}": File too large (${formatFileSize(file.size)}, max 10MB)`);
      }

      totalSize += file.size;
    }

    // Check aggregate size
    if (totalSize > MAX_AGGREGATE_SIZE) {
      errors.push(`Total size exceeds 100MB (${formatFileSize(totalSize)})`);
    }

    return { valid: errors.length === 0, errors };
  }

  function handleFileSelection(files) {
    const validation = validateFiles(files);

    if (!validation.valid) {
      showToast(validation.errors.join('\n'), 'error');
      return;
    }

    selectedFiles = Array.from(files);
    renderQueue();
  }

  function renderQueue() {
    queueTbody.innerHTML = '';

    selectedFiles.forEach(file => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${file.name}</td>
        <td>${formatFileSize(file.size)}</td>
        <td>${getFileType(file.type)}</td>
      `;
      queueTbody.appendChild(row);
    });

    fileCountSpan.textContent = selectedFiles.length;
    queueSection.hidden = false;

    // Disable upload buttons during queue
    manualUploadBtn.disabled = true;
    gmailImportBtn.disabled = true;
  }

  // ======================
  // Manual Upload Flow
  // ======================

  async function startBatchProcessing() {
    if (selectedFiles.length === 0) return;

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('analysisFile', file);
    });

    try {
      // Hide queue, show progress
      queueSection.hidden = true;
      progressSection.hidden = false;
      startProcessingBtn.disabled = true;

      const response = await fetch('/api/analyze-labs/batch', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start batch processing');
      }

      const data = await response.json();
      currentBatchId = data.batch_id;

      // Initialize progress table
      renderProgressTable(data.jobs);

      // Start polling
      startManualBatchPolling(data.batch_id);
    } catch (error) {
      console.error('Batch upload failed:', error);
      showToast('Failed to start batch processing: ' + error.message, 'error');
      queueSection.hidden = false;
      progressSection.hidden = true;
      startProcessingBtn.disabled = false;
    }
  }

  function renderProgressTable(jobs) {
    progressTbody.innerHTML = '';

    jobs.forEach(job => {
      const row = document.createElement('tr');
      row.dataset.jobId = job.job_id;
      row.innerHTML = `
        <td class="filename">${job.filename}</td>
        <td class="status"><span class="status-icon">⏳</span> Pending</td>
        <td class="progress">
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" style="width: 0%"></div>
          </div>
          <span class="progress-percent">0%</span>
        </td>
        <td class="details">Queued</td>
      `;
      progressTbody.appendChild(row);
    });
  }

  function startManualBatchPolling(batchId) {
    if (pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
      try {
        const response = await fetch(`/api/analyze-labs/batches/${batchId}`);

        if (!response.ok) {
          throw new Error('Failed to get batch status');
        }

        const batch = await response.json();

        // Update progress table
        batch.jobs.forEach(job => {
          const row = progressTbody.querySelector(`tr[data-job-id="${job.job_id}"]`);
          if (!row) return;

          // Update status
          const statusCell = row.querySelector('.status');
          const statusIcon = getStatusIcon(job.status);
          const statusLabel = getStatusLabel(job.status);
          statusCell.innerHTML = `<span class="status-icon">${statusIcon}</span> ${statusLabel}`;

          // Update progress bar
          const progressFill = row.querySelector('.progress-bar-fill');
          const progressPercent = row.querySelector('.progress-percent');
          progressFill.style.width = job.progress + '%';
          progressPercent.textContent = job.progress + '%';

          // Update details
          const detailsCell = row.querySelector('.details');
          detailsCell.textContent = job.progress_message || getStatusLabel(job.status);

          // Store report ID for results
          if (job.report_id) {
            row.dataset.reportId = job.report_id;
          }
          if (job.error) {
            row.dataset.error = job.error;
          }
        });

        // Check if complete
        if (batch.all_complete) {
          clearInterval(pollTimer);
          showResults(batch.jobs, 'manual');
        }
      } catch (error) {
        console.error('Polling error:', error);
        clearInterval(pollTimer);
        showToast('Failed to poll batch status', 'error');
      }
    }, POLL_INTERVAL);
  }

  function getStatusIcon(status) {
    switch (status) {
      case 'pending': return '⏳';
      case 'processing': return '🧠';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '⏳';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'pending': return 'Pending';
      case 'processing': return 'Processing';
      case 'completed': return 'Done';
      case 'failed': return 'Error';
      default: return status;
    }
  }

  function showResults(jobs, source) {
    // Hide progress, show results
    progressSection.hidden = true;
    resultsSection.hidden = false;

    // Calculate stats
    const succeeded = jobs.filter(j => j.status === 'completed').length;
    const failed = jobs.filter(j => j.status === 'failed').length;

    // For manual uploads, don't show duplicate count
    successCountSpan.textContent = succeeded;
    failedCountSpan.textContent = failed;
    duplicateStat.hidden = true;

    // Render results table
    resultsTbody.innerHTML = '';

    jobs.forEach(job => {
      const row = document.createElement('tr');
      row.dataset.reportId = job.report_id || '';

      const statusClass = job.status === 'completed' ? 'status-completed' : 'status-failed';
      const statusLabel = job.status === 'completed' ? '✅ Done' : '❌ Error';

      const actionHtml = job.status === 'completed' && job.report_id
        ? `<a href="/?reportId=${job.report_id}" target="_blank" class="view-button">View</a>`
        : `<button class="secondary-button" onclick="alert('${job.error || 'Unknown error'}')">Log</button>`;

      row.innerHTML = `
        <td>${job.filename}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>${actionHtml}</td>
      `;

      resultsTbody.appendChild(row);
    });
  }

  // ======================
  // Gmail Integration
  // ======================

  async function checkGmailStatus() {
    try {
      const response = await fetch('/api/dev-gmail/status');
      const data = await response.json();

      gmailAuthState = data;

      if (!data.enabled) {
        // Hide Gmail button entirely
        gmailImportBtn.hidden = true;
        return;
      }

      // Show Gmail button
      gmailImportBtn.hidden = false;

      if (data.connected) {
        authStatusMessage.innerHTML = `<p>✅ Connected: ${data.email}</p>`;
        gmailActionBtn.textContent = 'Fetch Emails';
        gmailActionBtn.onclick = fetchAndClassifyEmails;
      } else {
        authStatusMessage.innerHTML = '<p>⚠️ Gmail not connected</p>';
        gmailActionBtn.textContent = 'Connect Gmail Account';
        gmailActionBtn.onclick = connectGmail;
      }
    } catch (error) {
      console.error('Failed to check Gmail status:', error);
      gmailImportBtn.hidden = true;
    }
  }

  function showGmailSection() {
    gmailSection.hidden = false;
    manualUploadBtn.disabled = true;
  }

  function connectGmail() {
    // Open OAuth popup (similar to gmail-dev.js)
    const popup = window.open(
      'about:blank',
      'gmail-auth',
      'width=600,height=700,scrollbars=yes'
    );

    if (!popup) {
      showToast('Please allow popups for this site', 'error');
      return;
    }

    popup.document.write('<html><body style="font-family: system-ui; padding: 40px; text-align: center;"><h2>Loading...</h2></body></html>');

    fetch('/api/dev-gmail/auth-url')
      .then(res => res.json())
      .then(data => {
        popup.location.href = data.auth_url;

        // Listen for auth success
        const messageHandler = (event) => {
          if (event.data && event.data.type === 'gmail-auth-success') {
            window.removeEventListener('message', messageHandler);
            showToast('Gmail connected successfully!', 'success');
            checkGmailStatus();
          }
        };

        window.addEventListener('message', messageHandler);

        // Also check periodically
        const checkInterval = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkInterval);
            window.removeEventListener('message', messageHandler);
            setTimeout(() => checkGmailStatus(), 1000);
          }
        }, 500);
      })
      .catch(error => {
        popup.close();
        showToast('Failed to get auth URL: ' + error.message, 'error');
      });
  }

  async function fetchAndClassifyEmails() {
    try {
      // Show fetch progress, hide auth status
      gmailAuthStatus.hidden = true;
      gmailFetchProgress.hidden = false;
      gmailActionBtn.disabled = true;

      const response = await fetch('/api/dev-gmail/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to start fetch job');
      }

      const data = await response.json();
      pollGmailFetchJob(data.job_id);
    } catch (error) {
      console.error('Fetch failed:', error);
      showToast('Failed to fetch emails: ' + error.message, 'error');
      gmailAuthStatus.hidden = false;
      gmailFetchProgress.hidden = true;
      gmailActionBtn.disabled = false;
    }
  }

  async function pollGmailFetchJob(jobId) {
    const pollTimer = setInterval(async () => {
      try {
        const response = await fetch(`/api/dev-gmail/jobs/${jobId}`);
        const job = await response.json();

        // Update progress
        if (job.status === 'processing') {
          const progress = job.progress || 0;
          gmailProgressFill.style.width = progress + '%';
          gmailProgressPercent.textContent = progress + '%';

          // Update step list
          updateGmailStepList(progress, job.progressMessage);
        }

        if (job.status === 'completed') {
          clearInterval(pollTimer);
          gmailFetchProgress.hidden = true;

          const results = job.result?.results || [];

          if (results.length === 0) {
            showToast('No lab result emails found', 'info');
            gmailAuthStatus.hidden = false;
            gmailActionBtn.disabled = false;
          } else {
            showAttachmentSelection(results);
          }
        }

        if (job.status === 'failed') {
          clearInterval(pollTimer);
          showToast('Fetch failed: ' + (job.error || 'Unknown error'), 'error');
          gmailFetchProgress.hidden = true;
          gmailAuthStatus.hidden = false;
          gmailActionBtn.disabled = false;
        }
      } catch (error) {
        console.error('Polling error:', error);
        clearInterval(pollTimer);
      }
    }, POLL_INTERVAL);
  }

  function updateGmailStepList(progress, message) {
    const steps = [
      { range: [0, 50], label: 'Step 1: Fetching & classifying metadata' },
      { range: [50, 90], label: 'Step 2: Analyzing email bodies' }
    ];

    let html = '';
    steps.forEach(step => {
      const isActive = progress >= step.range[0] && progress < step.range[1];
      const isCompleted = progress >= step.range[1];
      const className = isCompleted ? 'completed' : (isActive ? 'active' : '');

      html += `<li class="${className}">
        ${isCompleted ? '✅' : (isActive ? '🔄' : '⏳')} ${step.label}
        ${isActive && message ? `<br><small>${message}</small>` : ''}
      </li>`;
    });

    gmailStepList.innerHTML = html;
  }

  function showAttachmentSelection(results) {
    gmailSelection.hidden = false;

    // Summary
    const totalAttachments = results.reduce((sum, email) => sum + email.attachments.length, 0);
    gmailSelectionSummary.innerHTML = `<p>✅ Found ${results.length} lab result emails with ${totalAttachments} attachments</p>`;

    // Render table
    attachmentSelectionTbody.innerHTML = '';

    results.forEach(email => {
      email.attachments.forEach(att => {
        const row = document.createElement('tr');

        const isDuplicate = email.is_duplicate || false;
        const dupWarning = isDuplicate ? '⚠️' : '-';

        row.innerHTML = `
          <td><input type="checkbox" class="attachment-checkbox" data-email-id="${email.id}" data-attachment-id="${att.attachmentId}" data-filename="${att.filename}" data-mimetype="${att.mimeType}" data-size="${att.size}"></td>
          <td>
            <div><strong>From:</strong> ${email.from}</div>
            <div><strong>Subject:</strong> ${email.subject}</div>
            <div><strong>Date:</strong> ${email.date}</div>
          </td>
          <td>${att.filename}</td>
          <td>${formatFileSize(att.size)}</td>
          <td>${dupWarning}</td>
        `;

        attachmentSelectionTbody.appendChild(row);
      });
    });

    updateSelectionCount();
  }

  function updateSelectionCount() {
    const checkboxes = document.querySelectorAll('.attachment-checkbox');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    selectedCountSpan.textContent = checked.length;
    downloadRecognizeBtn.disabled = checked.length === 0;
  }

  async function startGmailIngestion() {
    const checkboxes = document.querySelectorAll('.attachment-checkbox:checked');

    if (checkboxes.length === 0) {
      showToast('No attachments selected', 'error');
      return;
    }

    const selections = Array.from(checkboxes).map(cb => ({
      messageId: cb.dataset.emailId,
      attachmentId: cb.dataset.attachmentId,
      filename: cb.dataset.filename,
      mimeType: cb.dataset.mimetype,
      size: parseInt(cb.dataset.size)
    }));

    try {
      downloadRecognizeBtn.disabled = true;

      const response = await fetch('/api/dev-gmail/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections })
      });

      if (!response.ok) {
        throw new Error('Failed to start ingestion');
      }

      const data = await response.json();

      // Hide Gmail section, show progress
      gmailSection.hidden = true;
      progressSection.hidden = false;

      // Poll Gmail batch summary
      startGmailBatchPolling(data.batchId);
    } catch (error) {
      console.error('Ingestion failed:', error);
      showToast('Failed to start ingestion: ' + error.message, 'error');
      downloadRecognizeBtn.disabled = false;
    }
  }

  async function startGmailBatchPolling(batchId) {
    if (pollTimer) clearInterval(pollTimer);

    // Initialize progress table
    progressTbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';

    pollTimer = setInterval(async () => {
      try {
        const response = await fetch(`/api/dev-gmail/jobs/summary?batchId=${batchId}`);
        const summary = await response.json();

        // Render/update progress table
        if (progressTbody.querySelector('td[colspan="4"]')) {
          // First poll - initialize table
          progressTbody.innerHTML = '';
          summary.attachments.forEach(att => {
            const row = document.createElement('tr');
            row.dataset.filename = att.filename;
            row.innerHTML = `
              <td class="filename">${att.filename}</td>
              <td class="status"><span class="status-icon">⏳</span> Queued</td>
              <td class="progress">
                <div class="progress-bar-wrapper">
                  <div class="progress-bar-fill" style="width: 0%"></div>
                </div>
                <span class="progress-percent">0%</span>
              </td>
              <td class="details">Waiting</td>
            `;
            progressTbody.appendChild(row);
          });
        }

        // Update rows
        summary.attachments.forEach(att => {
          const row = progressTbody.querySelector(`tr[data-filename="${att.filename}"]`);
          if (!row) return;

          // Update status
          const statusCell = row.querySelector('.status');
          const statusIcon = getGmailStatusIcon(att.status);
          const statusLabel = getGmailStatusLabel(att.status);
          statusCell.innerHTML = `<span class="status-icon">${statusIcon}</span> ${statusLabel}`;

          // Update progress
          const progressFill = row.querySelector('.progress-bar-fill');
          const progressPercent = row.querySelector('.progress-percent');
          const progress = att.progress || 0;
          progressFill.style.width = progress + '%';
          progressPercent.textContent = progress + '%';

          // Update details
          const detailsCell = row.querySelector('.details');
          detailsCell.textContent = att.progressMessage || statusLabel;

          // Store data
          if (att.reportId) row.dataset.reportId = att.reportId;
          if (att.error) row.dataset.error = att.error;
          row.dataset.status = att.status;
        });

        // Check if complete
        if (summary.allComplete) {
          clearInterval(pollTimer);
          showGmailResults(summary.attachments);
        }
      } catch (error) {
        console.error('Gmail polling error:', error);
        clearInterval(pollTimer);
      }
    }, POLL_INTERVAL);
  }

  function getGmailStatusIcon(status) {
    switch (status) {
      case 'queued': return '⏳';
      case 'downloading': return '⬇️';
      case 'processing': return '🧠';
      case 'completed': return '✅';
      case 'updated': return '🔄';
      case 'duplicate': return '🔄';
      case 'failed': return '❌';
      default: return '⏳';
    }
  }

  function getGmailStatusLabel(status) {
    switch (status) {
      case 'queued': return 'Queued';
      case 'downloading': return 'Downloading';
      case 'processing': return 'Processing';
      case 'completed': return 'Done';
      case 'updated': return 'Updated';
      case 'duplicate': return 'Duplicate';
      case 'failed': return 'Error';
      default: return status;
    }
  }

  function showGmailResults(attachments) {
    // Hide progress, show results
    progressSection.hidden = true;
    resultsSection.hidden = false;

    // Calculate stats (Gmail-specific)
    const succeeded = attachments.filter(a => a.status === 'completed' || a.status === 'updated').length;
    const duplicates = attachments.filter(a => a.status === 'duplicate').length;
    const failed = attachments.filter(a => a.status === 'failed').length;

    successCountSpan.textContent = succeeded;
    duplicateCountSpan.textContent = duplicates;
    failedCountSpan.textContent = failed;
    duplicateStat.hidden = false; // Show duplicate stat for Gmail

    // Render results table
    resultsTbody.innerHTML = '';

    attachments.forEach(att => {
      const row = document.createElement('tr');
      row.dataset.reportId = att.reportId || '';

      let statusClass, statusLabel;
      if (att.status === 'completed') {
        statusClass = 'status-completed';
        statusLabel = '✅ Done';
      } else if (att.status === 'updated') {
        statusClass = 'status-updated';
        statusLabel = '🔄 Updated';
      } else if (att.status === 'duplicate') {
        statusClass = 'status-duplicate';
        statusLabel = '🔄 Duplicate';
      } else {
        statusClass = 'status-failed';
        statusLabel = '❌ Error';
      }

      const actionHtml = att.reportId
        ? `<a href="/?reportId=${att.reportId}" target="_blank" class="view-button">View</a>`
        : `<button class="secondary-button" onclick="alert('${att.error || 'Unknown error'}')">Log</button>`;

      row.innerHTML = `
        <td>${att.filename}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>${actionHtml}</td>
      `;

      resultsTbody.appendChild(row);
    });
  }

  // ======================
  // Event Listeners
  // ======================

  // Manual upload button
  manualUploadBtn.addEventListener('click', () => {
    multiFileInput.click();
  });

  // File input change
  multiFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files);
    }
  });

  // Drag and drop (on upload source buttons area)
  const uploadSourceSelector = document.querySelector('.upload-source-selector');
  uploadSourceSelector.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadSourceSelector.style.borderColor = '#3b82f6';
  });

  uploadSourceSelector.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadSourceSelector.style.borderColor = '';
  });

  uploadSourceSelector.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadSourceSelector.style.borderColor = '';

    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files);
    }
  });

  // Start processing button
  startProcessingBtn.addEventListener('click', startBatchProcessing);

  // Gmail import button
  gmailImportBtn.addEventListener('click', showGmailSection);

  // Gmail attachment selection
  selectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.attachment-checkbox').forEach(cb => cb.checked = true);
    updateSelectionCount();
  });

  deselectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.attachment-checkbox').forEach(cb => cb.checked = false);
    updateSelectionCount();
  });

  downloadRecognizeBtn.addEventListener('click', startGmailIngestion);

  // Checkbox change listener (delegate)
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('attachment-checkbox')) {
      updateSelectionCount();
    }
  });

  // ======================
  // Initialization
  // ======================

  // Check Gmail status on page load (only in normal upload mode)
  checkGmailStatus();
})();
