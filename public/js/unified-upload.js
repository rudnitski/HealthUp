/**
 * Unified Upload and Ingestion UI
 * PRD v3.0: Handles both manual multi-file uploads and Gmail import
 */

(() => {
  // Check if we're viewing a specific report (reportId in URL)
  // If so, show report viewing UI and exit early - app.js will handle the report loading
  const urlParams = new URLSearchParams(window.location.search);
  const reportIdParam = urlParams.get('reportId');

  if (reportIdParam) {
    const unifiedUi = document.getElementById('unified-upload-ui');
    const reportViewUi = document.getElementById('report-view-ui');

    if (unifiedUi) {
      unifiedUi.style.display = 'none';
      unifiedUi.hidden = true;
    }

    if (reportViewUi) {
      reportViewUi.style.display = 'block';
      reportViewUi.hidden = false;
    }

    console.log('[unified-upload] Report view mode - showing report UI for reportId:', reportIdParam);
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
    'image/heic'
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
  const clearQueueBtn = document.getElementById('clear-queue-btn');
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

  /**
   * Generate unique key for file deduplication
   * Uses filename + size + lastModified timestamp
   * Note: Browser security prevents access to full file paths
   */
  function getFileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
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

  function handleFileSelection(files, append = false) {
    // Convert to array
    const newFiles = Array.from(files);

    // Deduplicate: track unique files by filename + size + lastModified
    const existingKeys = new Set(selectedFiles.map(f => getFileKey(f)));
    const uniqueNewFiles = [];
    const duplicates = [];

    for (const file of newFiles) {
      const key = getFileKey(file);
      if (existingKeys.has(key)) {
        duplicates.push(file.name);
      } else {
        uniqueNewFiles.push(file);
        existingKeys.add(key);
      }
    }

    // Show notification if duplicates were skipped
    if (duplicates.length > 0) {
      const uniqueNames = [...new Set(duplicates)]; // Remove duplicate names from list
      const message = uniqueNames.length === 1
        ? `File "${uniqueNames[0]}" was already added (skipped)`
        : `${uniqueNames.length} duplicate files were skipped:\n${uniqueNames.join('\n')}`;
      showToast(message, 'info');
    }

    // Combine with existing files if appending
    const filesToValidate = append
      ? [...selectedFiles, ...uniqueNewFiles]
      : uniqueNewFiles;

    // Validate the final set
    const validation = validateFiles(filesToValidate);

    if (!validation.valid) {
      showToast(validation.errors.join('\n'), 'error');
      return;
    }

    selectedFiles = filesToValidate;
    renderQueue();
  }

  function clearQueue() {
    selectedFiles = [];
    queueSection.hidden = true;
    queueTbody.innerHTML = '';
    fileCountSpan.textContent = '0';

    // Re-enable upload buttons
    manualUploadBtn.disabled = false;
    gmailImportBtn.disabled = false;
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
    queueSection.hidden = selectedFiles.length === 0;

    // Disable upload buttons when queue has files
    if (selectedFiles.length > 0) {
      manualUploadBtn.disabled = true;
      gmailImportBtn.disabled = true;
    }
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

      let statusClass, statusLabel;
      if (job.status === 'completed') {
        statusClass = 'status-completed';
        const paramCount = job.parameters?.length ?? 0;
        statusLabel = `✅ ${paramCount} results`;
      } else {
        statusClass = 'status-failed';
        statusLabel = '❌ Error';
      }

      const filenameCell = document.createElement('td');
      filenameCell.textContent = job.filename || '';
      row.appendChild(filenameCell);

      const statusCell = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge ${statusClass}`;
      statusBadge.textContent = statusLabel;
      statusCell.appendChild(statusBadge);
      row.appendChild(statusCell);

      const actionCell = document.createElement('td');
      if (job.status === 'completed' && job.report_id) {
        const viewLink = document.createElement('a');
        viewLink.href = `/?reportId=${job.report_id}`;
        viewLink.target = '_blank';
        viewLink.className = 'view-button';
        viewLink.textContent = 'View';
        actionCell.appendChild(viewLink);

        // Add View Original File button
        const viewOriginalLink = document.createElement('a');
        viewOriginalLink.href = `/api/reports/${job.report_id}/original-file`;
        viewOriginalLink.target = '_blank';
        viewOriginalLink.className = 'view-button secondary-button';
        viewOriginalLink.textContent = '📄 View Original';
        viewOriginalLink.style.marginLeft = '0.5rem';
        actionCell.appendChild(viewOriginalLink);
      } else {
        const logButton = document.createElement('button');
        logButton.type = 'button';
        logButton.className = 'secondary-button';
        logButton.textContent = 'Log';
        const errorMessage = job.error || 'Unknown error';
        logButton.addEventListener('click', () => alert(errorMessage));
        actionCell.appendChild(logButton);
      }
      row.appendChild(actionCell);

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
          const stats = job.result?.stats || {};

          // Show classification stats
          if (stats.step1_total_fetched) {
            const fetchedCount = stats.step1_total_fetched;
            const classifiedCount = stats.step1_classified || fetchedCount;
            const extraCount = stats.step1_extra || 0;
            const missingCount = stats.step1_missing || 0;
            const candidatesCount = stats.step1_candidates || 0;

            let statsMsg = `📊 Fetched ${fetchedCount} emails from Gmail`;
            if (extraCount > 0) {
              statsMsg += ` → ⚠️ LLM returned ${classifiedCount} (+${extraCount} duplicates)`;
            } else if (missingCount > 0) {
              statsMsg += ` → ⚠️ LLM classified ${classifiedCount} (${missingCount} missing)`;
            } else {
              statsMsg += ` → ✅ LLM classified all ${classifiedCount}`;
            }
            statsMsg += ` → 🎯 ${candidatesCount} candidates found → ${results.length} emails accepted`;

            showToast(statsMsg, (extraCount > 0 || missingCount > 0) ? 'warning' : 'success', 8000);
          }

          if (results.length === 0) {
            showToast('No lab result emails found', 'info');
            gmailAuthStatus.hidden = false;
            gmailActionBtn.disabled = false;
          } else {
            const rejectedEmails = job.result?.rejectedEmails || [];
            const attachmentRejectedEmails = job.result?.attachmentRejectedEmails || [];
            const attachmentProblemEmails = job.result?.attachmentProblemEmails || [];
            const rejectedAttachments = job.result?.rejectedAttachments || [];
            showAttachmentSelection(results, stats, rejectedEmails, attachmentRejectedEmails, attachmentProblemEmails, rejectedAttachments);
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

  function showAttachmentSelection(results, stats = {}, rejectedEmails = [], attachmentRejectedEmails = [], attachmentProblemEmails = [], rejectedAttachments = []) {
    gmailSelection.hidden = false;

    // Summary
    const totalAttachments = results.reduce((sum, email) => sum + email.attachments.length, 0);
    let summaryHtml = `<p>✅ Found ${results.length} lab result emails with ${totalAttachments} attachments</p>`;

    // Add detailed stats if available
    if (stats.step1_total_fetched) {
      const fetchedCount = stats.step1_total_fetched;
      const classifiedCount = stats.step1_classified || fetchedCount;
      const extraCount = stats.step1_extra || 0;
      const missingCount = stats.step1_missing || 0;
      const candidatesCount = stats.step1_candidates || 0;

      summaryHtml += `<p style="font-size: 0.9em; color: #666; margin-top: 8px;">`;
      summaryHtml += `📊 Gmail API: ${fetchedCount} emails`;
      if (extraCount > 0) {
        summaryHtml += ` → LLM: ${classifiedCount} <span style="color: #e67e00;">(⚠️ +${extraCount} duplicates)</span>`;
      } else if (missingCount > 0) {
        summaryHtml += ` → LLM: ${classifiedCount} <span style="color: #e67e00;">(⚠️ ${missingCount} missing)</span>`;
      } else {
        summaryHtml += ` → LLM: ${classifiedCount}`;
      }
      summaryHtml += ` → ${candidatesCount} candidates → ${results.length} accepted`;
      summaryHtml += `</p>`;
    }

    // Add rejected emails section (collapsed by default)
    if (rejectedEmails.length > 0) {
      const rejectedId = 'rejected-emails-section-' + Date.now();
      summaryHtml += `
        <div style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
          <button
            type="button"
            id="${rejectedId}-toggle"
            style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.9em; padding: 4px 8px; display: flex; align-items: center; gap: 6px;"
            onclick="
              const content = document.getElementById('${rejectedId}-content');
              const icon = document.getElementById('${rejectedId}-icon');
              if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
              } else {
                content.style.display = 'none';
                icon.textContent = '▶';
              }
            ">
            <span id="${rejectedId}-icon">▶</span>
            <span>Show ${rejectedEmails.length} rejected emails (Step 2)</span>
          </button>
          <div id="${rejectedId}-content" style="display: none; margin-top: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
              <thead>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <th style="text-align: left; padding: 8px;">Subject</th>
                  <th style="text-align: left; padding: 8px;">From</th>
                  <th style="text-align: left; padding: 8px;">Date</th>
                  <th style="text-align: center; padding: 8px;">Confidence</th>
                  <th style="text-align: left; padding: 8px;">Reason</th>
                </tr>
              </thead>
              <tbody>
                ${rejectedEmails.map(email => `
                  <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 8px;">${email.subject || '(no subject)'}</td>
                    <td style="padding: 8px;">${email.from || '(unknown)'}</td>
                    <td style="padding: 8px; white-space: nowrap;">${email.date || '-'}</td>
                    <td style="padding: 8px; text-align: center;">${email.step2_confidence !== undefined ? email.step2_confidence.toFixed(2) : '-'}</td>
                    <td style="padding: 8px; color: #6b7280;">${email.step2_reason || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Add attachment issues section (collapsed by default)
    if (attachmentRejectedEmails.length > 0) {
      const attachId = 'attachment-rejected-section-' + Date.now();
      summaryHtml += `
        <div style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
          <button
            type="button"
            id="${attachId}-toggle"
            style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.9em; padding: 4px 8px; display: flex; align-items: center; gap: 6px;"
            onclick="
              const content = document.getElementById('${attachId}-content');
              const icon = document.getElementById('${attachId}-icon');
              if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
              } else {
                content.style.display = 'none';
                icon.textContent = '▶';
              }
            ">
            <span id="${attachId}-icon">▶</span>
            <span>Show ${attachmentRejectedEmails.length} emails with attachment issues</span>
          </button>
          <div id="${attachId}-content" style="display: none; margin-top: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
              <thead>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <th style="text-align: left; padding: 8px;">Subject</th>
                  <th style="text-align: left; padding: 8px;">From</th>
                  <th style="text-align: left; padding: 8px;">Date</th>
                  <th style="text-align: left; padding: 8px;">Issues</th>
                </tr>
              </thead>
              <tbody>
                ${attachmentRejectedEmails.map(email => `
                  <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 8px;">${email.subject || '(no subject)'}</td>
                    <td style="padding: 8px;">${email.from || '(unknown)'}</td>
                    <td style="padding: 8px; white-space: nowrap;">${email.date || '-'}</td>
                    <td style="padding: 8px; color: #6b7280;">
                      <ul style="margin: 0; padding-left: 18px;">
                        ${(email.issues || []).map(issue => `<li>${issue.filename || '(unknown)'} — ${issue.reason || 'Unknown reason'}</li>`).join('')}
                      </ul>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Add accepted emails that lost attachments (collapsed by default)
    if (attachmentProblemEmails.length > 0) {
      const missingId = 'attachment-missing-section-' + Date.now();
      summaryHtml += `
        <div style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
          <button
            type="button"
            id="${missingId}-toggle"
            style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.9em; padding: 4px 8px; display: flex; align-items: center; gap: 6px;"
            onclick="
              const content = document.getElementById('${missingId}-content');
              const icon = document.getElementById('${missingId}-icon');
              if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
              } else {
                content.style.display = 'none';
                icon.textContent = '▶';
              }
            ">
            <span id="${missingId}-icon">▶</span>
            <span>Show ${attachmentProblemEmails.length} accepted emails with no usable attachments</span>
          </button>
          <div id="${missingId}-content" style="display: none; margin-top: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
              <thead>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <th style="text-align: left; padding: 8px;">Subject</th>
                  <th style="text-align: left; padding: 8px;">From</th>
                  <th style="text-align: left; padding: 8px;">Date</th>
                  <th style="text-align: left; padding: 8px;">Issues</th>
                </tr>
              </thead>
              <tbody>
                ${attachmentProblemEmails.map(email => `
                  <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 8px;">${email.subject || '(no subject)'}</td>
                    <td style="padding: 8px;">${email.from || '(unknown)'}</td>
                    <td style="padding: 8px; white-space: nowrap;">${email.date || '-'}</td>
                    <td style="padding: 8px; color: #6b7280;">
                      <ul style="margin: 0; padding-left: 18px;">
                        ${(email.issues || []).map(issue => `<li>${issue.filename || '(unknown)'} — ${issue.reason || 'Unknown reason'}</li>`).join('')}
                      </ul>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // [NEW] Show rejected attachments (Step 2: Attachment-level filtering)
    // This section shows attachments filtered from ACCEPTED emails only
    // (Attachments from rejected emails are already covered in first debug section)
    if (rejectedAttachments && rejectedAttachments.length > 0) {
      const totalRejected = rejectedAttachments.reduce((sum, e) => sum + e.rejected.length, 0);
      const rejectedAttId = 'rejected-attachments-section-' + Date.now();

      summaryHtml += `
        <div style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
          <button
            type="button"
            id="${rejectedAttId}-toggle"
            style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.9em; padding: 4px 8px; display: flex; align-items: center; gap: 6px;"
            onclick="
              const content = document.getElementById('${rejectedAttId}-content');
              const icon = document.getElementById('${rejectedAttId}-icon');
              if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
              } else {
                content.style.display = 'none';
                icon.textContent = '▶';
              }
            ">
            <span id="${rejectedAttId}-icon">▶</span>
            <span>Show ${totalRejected} rejected attachment${totalRejected > 1 ? 's' : ''} (Step 2: Non-lab-report files filtered)</span>
          </button>
          <div id="${rejectedAttId}-content" style="display: none; margin-top: 8px;">
            <p style="margin-bottom: 10px; color: #6b7280; font-size: 0.9em;">
              These attachments were filtered out during email body classification because their filenames and context
              suggest they are not lab reports (e.g., logos, signatures, decorative images).
              If you believe an attachment was incorrectly filtered, please report this as a bug.
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
              <thead>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <th style="text-align: left; padding: 8px;">Email</th>
                  <th style="text-align: left; padding: 8px;">Rejected Attachment</th>
                  <th style="text-align: left; padding: 8px;">Size</th>
                  <th style="text-align: left; padding: 8px;">Reason</th>
                </tr>
              </thead>
              <tbody>
                ${rejectedAttachments.map(email =>
                  email.rejected.map(att => `
                    <tr style="border-bottom: 1px solid #f3f4f6;">
                      <td style="padding: 8px;">
                        <strong>From:</strong> ${email.from || '(unknown)'}<br>
                        <strong>Subject:</strong> ${email.subject || '(no subject)'}
                      </td>
                      <td style="padding: 8px;">
                        <code>${att.filename}</code>
                      </td>
                      <td style="padding: 8px; white-space: nowrap;">
                        ${formatFileSize(att.size)}
                      </td>
                      <td style="padding: 8px; color: #6b7280;">
                        ${att.reason}
                      </td>
                    </tr>
                  `).join('')
                ).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    gmailSelectionSummary.innerHTML = summaryHtml;

    // Render table
    attachmentSelectionTbody.innerHTML = '';

    results.forEach(email => {
      email.attachments.forEach(att => {
        const row = document.createElement('tr');

        const checkboxCell = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'attachment-checkbox';
        checkbox.dataset.emailId = email.id;
        checkbox.dataset.attachmentId = att.attachmentId;
        checkbox.dataset.filename = att.filename;
        checkbox.dataset.mimetype = att.mimeType;
        checkbox.dataset.size = att.size;
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);

        const infoCell = document.createElement('td');
        const fromDiv = document.createElement('div');
        const fromStrong = document.createElement('strong');
        fromStrong.textContent = 'From:';
        fromDiv.appendChild(fromStrong);
        fromDiv.appendChild(document.createTextNode(` ${email.from || ''}`));

        const subjectDiv = document.createElement('div');
        const subjectStrong = document.createElement('strong');
        subjectStrong.textContent = 'Subject:';
        subjectDiv.appendChild(subjectStrong);
        subjectDiv.appendChild(document.createTextNode(` ${email.subject || ''}`));

        const dateDiv = document.createElement('div');
        const dateStrong = document.createElement('strong');
        dateStrong.textContent = 'Date:';
        dateDiv.appendChild(dateStrong);
        dateDiv.appendChild(document.createTextNode(` ${email.date || ''}`));

        infoCell.appendChild(fromDiv);
        infoCell.appendChild(subjectDiv);
        infoCell.appendChild(dateDiv);
        row.appendChild(infoCell);

        const filenameCell = document.createElement('td');
        filenameCell.textContent = att.filename || '';
        row.appendChild(filenameCell);

        const sizeCell = document.createElement('td');
        sizeCell.textContent = formatFileSize(att.size);
        row.appendChild(sizeCell);

        const duplicateCell = document.createElement('td');
        duplicateCell.textContent = (email.is_duplicate || false) ? '⚠️' : '-';
        row.appendChild(duplicateCell);

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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start ingestion');
      }

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
            // Use composite key (messageId-attachmentId) to handle duplicate filenames
            row.dataset.attachmentKey = `${att.messageId}-${att.attachmentId}`;
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
          const attachmentKey = `${att.messageId}-${att.attachmentId}`;
          const row = progressTbody.querySelector(`tr[data-attachment-key="${attachmentKey}"]`);
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
        const paramCount = att.parameters?.length ?? 0;
        statusLabel = `✅ ${paramCount} results`;
      } else if (att.status === 'updated') {
        statusClass = 'status-updated';
        const paramCount = att.parameters?.length ?? 0;
        statusLabel = `🔄 Updated (${paramCount} results)`;
      } else if (att.status === 'duplicate') {
        statusClass = 'status-duplicate';
        statusLabel = '🔄 Duplicate';
      } else {
        statusClass = 'status-failed';
        statusLabel = '❌ Error';
      }

      const filenameCell = document.createElement('td');
      filenameCell.textContent = att.filename || '';
      row.appendChild(filenameCell);

      const statusCell = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge ${statusClass}`;
      statusBadge.textContent = statusLabel;
      statusCell.appendChild(statusBadge);
      row.appendChild(statusCell);

      const actionCell = document.createElement('td');
      if (att.reportId) {
        const viewLink = document.createElement('a');
        viewLink.href = `/?reportId=${att.reportId}`;
        viewLink.target = '_blank';
        viewLink.className = 'view-button';
        viewLink.textContent = 'View';
        actionCell.appendChild(viewLink);

        // Add View Original File button
        const viewOriginalLink = document.createElement('a');
        viewOriginalLink.href = `/api/reports/${att.reportId}/original-file`;
        viewOriginalLink.target = '_blank';
        viewOriginalLink.className = 'view-button secondary-button';
        viewOriginalLink.textContent = '📄 View Original';
        viewOriginalLink.style.marginLeft = '0.5rem';
        actionCell.appendChild(viewOriginalLink);
      } else {
        const logButton = document.createElement('button');
        logButton.type = 'button';
        logButton.className = 'secondary-button';
        logButton.textContent = 'Log';
        const errorMessage = att.error || 'Unknown error';
        logButton.addEventListener('click', () => alert(errorMessage));
        actionCell.appendChild(logButton);
      }
      row.appendChild(actionCell);

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
      // Append files when using file picker (allows adding more files)
      handleFileSelection(e.target.files, true);
      // Reset the input so the same files can be selected again if needed
      e.target.value = '';
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
      // Append files when drag-and-dropping (allows adding files one by one)
      handleFileSelection(e.dataTransfer.files, true);
    }
  });

  // Start processing button
  startProcessingBtn.addEventListener('click', startBatchProcessing);

  // Clear queue button
  clearQueueBtn.addEventListener('click', clearQueue);

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
