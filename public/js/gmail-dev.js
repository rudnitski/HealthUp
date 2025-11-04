/**
 * Gmail Dev UI
 * Client-side logic for Gmail integration developer interface (Step-2: Body Analysis)
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step2.md
 */

// DOM Elements - Connection Section
const statusLoading = document.getElementById('status-loading');
const statusDisconnected = document.getElementById('status-disconnected');
const statusConnected = document.getElementById('status-connected');
const statusError = document.getElementById('status-error');
const statusErrorMessage = document.getElementById('status-error-message');
const connectedEmail = document.getElementById('connected-email');
const connectBtn = document.getElementById('connect-btn');
const fetchBtn = document.getElementById('fetch-btn');

// DOM Elements - Results Section
const resultsSection = document.getElementById('results-section');
const jobLoading = document.getElementById('job-loading');
const jobError = document.getElementById('job-error');
const jobErrorMessage = document.getElementById('job-error-message');
const resultsEmpty = document.getElementById('results-empty');
const resultsContainer = document.getElementById('results-container');
const resultsTable = document.getElementById('results-table');
const resultsTbody = document.getElementById('results-tbody');

// Toast container
const toastContainer = document.getElementById('toast-container');

// State
let pollInterval = null;

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Check connection status on page load
 */
async function checkStatus() {
  try {
    statusLoading.hidden = false;
    statusDisconnected.hidden = true;
    statusConnected.hidden = true;
    statusError.hidden = true;

    const response = await fetch('/api/dev-gmail/status');

    if (!response.ok) {
      if (response.status === 403) {
        const data = await response.json();
        throw new Error(data.message || 'Gmail integration is not available');
      }
      throw new Error('Failed to check status');
    }

    const data = await response.json();

    statusLoading.hidden = true;

    if (data.connected) {
      statusConnected.hidden = false;
      connectedEmail.textContent = data.email || 'Unknown';
    } else {
      statusDisconnected.hidden = false;
    }
  } catch (error) {
    console.error('Status check failed:', error);
    statusLoading.hidden = true;
    statusError.hidden = false;
    statusErrorMessage.textContent = error.message;
  }
}

/**
 * Initiate OAuth flow
 */
async function connectGmail() {
  try {
    // Open popup IMMEDIATELY (before async fetch) to avoid popup blockers
    // We'll navigate it to the auth URL once we get it from the server
    const popup = window.open(
      'about:blank',
      'gmail-auth',
      'width=600,height=700,scrollbars=yes'
    );

    if (!popup) {
      showToast('Please allow popups for this site', 'error');
      return;
    }

    // Show loading message in popup while fetching auth URL
    popup.document.write('<html><body style="font-family: system-ui; padding: 40px; text-align: center;"><h2>Loading...</h2><p>Please wait while we prepare the authorization page.</p></body></html>');

    const response = await fetch('/api/dev-gmail/auth-url');

    if (!response.ok) {
      popup.close();
      throw new Error('Failed to get authorization URL');
    }

    const data = await response.json();
    const authUrl = data.auth_url;

    // Navigate the popup to the actual auth URL
    popup.location.href = authUrl;

    // Listen for auth success message
    const messageHandler = (event) => {
      if (event.data && event.data.type === 'gmail-auth-success') {
        window.removeEventListener('message', messageHandler);
        showToast('Gmail connected successfully!', 'success');
        checkStatus();
      }
    };

    window.addEventListener('message', messageHandler);

    // Also check status periodically in case message doesn't arrive
    const checkInterval = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkInterval);
        window.removeEventListener('message', messageHandler);
        // Wait a moment for the token to be saved
        setTimeout(() => checkStatus(), 1000);
      }
    }, 500);
  } catch (error) {
    console.error('OAuth flow failed:', error);
    showToast('Failed to connect Gmail: ' + error.message, 'error');
  }
}

/**
 * Start fetch and classify job
 */
async function fetchAndClassify() {
  try {
    // Show results section
    resultsSection.hidden = false;
    jobLoading.hidden = false;
    jobError.hidden = true;
    resultsEmpty.hidden = true;
    resultsContainer.hidden = true;

    // Disable fetch button
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Processing...';

    const response = await fetch('/api/dev-gmail/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Please reconnect your Gmail account');
      }
      throw new Error('Failed to start fetch job');
    }

    const data = await response.json();
    const jobId = data.job_id;

    console.log('Job started:', jobId);

    // Start polling for job status
    pollJobStatus(jobId);
  } catch (error) {
    console.error('Fetch failed:', error);
    jobLoading.hidden = true;
    jobError.hidden = false;
    jobErrorMessage.textContent = error.message;
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch & Classify Emails';
  }
}

/**
 * Poll job status
 */
async function pollJobStatus(jobId) {
  // Clear any existing poll interval
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  let attempts = 0;
  const maxAttempts = 300; // 10 minutes max (300 * 2 seconds)

  pollInterval = setInterval(async () => {
    attempts++;

    try {
      const response = await fetch(`/api/dev-gmail/jobs/${jobId}`);

      if (!response.ok) {
        throw new Error('Failed to get job status');
      }

      const job = await response.json();

      console.log('Job status:', job.status, 'Progress:', job.progress);

      // Update progress bar and message for processing jobs
      if (job.status === 'processing') {
        const progress = job.progress || 0;
        const progressMessage = job.progressMessage || 'Processing...';

        const progressBar = document.getElementById('job-progress-bar');
        const progressText = document.getElementById('job-progress-text');
        const progressMsg = document.getElementById('job-progress-message');

        if (progressBar) {
          progressBar.style.width = `${progress}%`;
          progressBar.textContent = `${progress}%`;
        }
        if (progressText) {
          progressText.textContent = `Processing emails... ${progress}%`;
        }
        if (progressMsg) {
          progressMsg.textContent = progressMessage;
        }
      }

      if (job.status === 'completed') {
        clearInterval(pollInterval);
        jobLoading.hidden = true;
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch & Classify Emails';

        const results = job.result?.results || [];
        const stats = job.result?.stats || {};
        const threshold = job.result?.threshold || 0.70;
        const debug = job.result?.debug || {};

        if (results.length === 0 && (!debug.step1_candidates || debug.step1_candidates.length === 0)) {
          resultsEmpty.hidden = false;
        } else {
          displayResults(results, stats, threshold, debug);
        }
      } else if (job.status === 'failed') {
        clearInterval(pollInterval);
        jobLoading.hidden = true;
        jobError.hidden = false;
        jobErrorMessage.textContent = job.error || 'Job failed';
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch & Classify Emails';
      } else if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        jobLoading.hidden = true;
        jobError.hidden = false;
        jobErrorMessage.textContent = 'Job timed out after 10 minutes. The job may still be running in the background.';
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch & Classify Emails';
      }
    } catch (error) {
      console.error('Polling error:', error);
      clearInterval(pollInterval);
      jobLoading.hidden = true;
      jobError.hidden = false;
      jobErrorMessage.textContent = 'Failed to poll job status: ' + error.message;
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch & Classify Emails';
    }
  }, 2000); // Poll every 2 seconds
}

/**
 * Display classification results (Step-1 → Step-2) with debug info
 */
function displayResults(results, stats, threshold, debug) {
  // Update Step-1 stats
  const step1Total = stats.step1_total_fetched || 0;
  const step1CandidatesCount = stats.step1_candidates || 0;
  const candidatePercent = step1Total > 0 ? ((step1CandidatesCount/step1Total)*100).toFixed(0) : 0;

  document.getElementById('step1-total').textContent = step1Total;
  document.getElementById('step1-candidates').textContent = `${step1CandidatesCount} (${candidatePercent}%)`;

  // Update Step-2 stats
  const step2Fetched = stats.step2_fetched_full || 0;
  const step2Classified = stats.step2_classified || 0;
  const finalResults = stats.final_results || 0;
  const acceptancePercent = step1CandidatesCount > 0 ? ((finalResults/step1CandidatesCount)*100).toFixed(0) : 0;

  document.getElementById('step2-fetched').textContent = step2Fetched;
  document.getElementById('step2-classified').textContent = step2Classified;
  document.getElementById('final-results-count').textContent = `${finalResults} (${acceptancePercent}% of candidates)`;
  document.getElementById('threshold-display').textContent = `${(threshold * 100).toFixed(0)}`;

  // Show error warning if classification failures occurred
  const errorWarning = document.getElementById('classification-error-warning');
  const errors = stats.step2_errors || 0;
  if (errors > 0) {
    errorWarning.textContent = `⚠️ ${errors} emails failed Step-2 classification due to API errors. Check server logs for details.`;
    errorWarning.hidden = false;
    errorWarning.style.color = '#f59e0b';
    errorWarning.style.padding = '10px';
    errorWarning.style.marginTop = '10px';
    errorWarning.style.backgroundColor = '#fef3c7';
    errorWarning.style.borderLeft = '4px solid #f59e0b';
  } else {
    errorWarning.hidden = true;
  }

  // Clear and populate Final Results table
  resultsTbody.innerHTML = '';

  if (results.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 7;
    emptyCell.textContent = 'No lab result emails found matching criteria';
    emptyCell.style.textAlign = 'center';
    emptyCell.style.padding = '20px';
    emptyCell.style.color = '#9ca3af';
    emptyRow.appendChild(emptyCell);
    resultsTbody.appendChild(emptyRow);
  } else {
    results.forEach(result => {
      const row = document.createElement('tr');

      // ID column
      const idCell = document.createElement('td');
      idCell.textContent = result.id.substring(0, 12) + '...';
      idCell.title = result.id;
      idCell.style.fontFamily = 'monospace';
      idCell.style.fontSize = '12px';
      row.appendChild(idCell);

      // Subject column
      const subjectCell = document.createElement('td');
      subjectCell.textContent = result.subject || '(no subject)';
      subjectCell.style.maxWidth = '250px';
      subjectCell.style.overflow = 'hidden';
      subjectCell.style.textOverflow = 'ellipsis';
      subjectCell.title = result.subject;
      row.appendChild(subjectCell);

      // From column
      const fromCell = document.createElement('td');
      fromCell.textContent = result.from || '(unknown)';
      fromCell.style.maxWidth = '180px';
      fromCell.style.overflow = 'hidden';
      fromCell.style.textOverflow = 'ellipsis';
      fromCell.title = result.from;
      row.appendChild(fromCell);

      // Date column
      const dateCell = document.createElement('td');
      const date = new Date(result.date);
      if (!isNaN(date)) {
        dateCell.textContent = date.toLocaleDateString();
        dateCell.title = date.toLocaleString();
      } else {
        dateCell.textContent = result.date ? result.date.substring(0, 16) : '';
      }
      row.appendChild(dateCell);

      // Confidence column
      const confidenceCell = document.createElement('td');
      const conf = result.step2_confidence || result.confidence || 0;
      confidenceCell.innerHTML = `<span style="color: #16a34a; font-weight: 600;">${(conf * 100).toFixed(0)}%</span>`;
      row.appendChild(confidenceCell);

      // Attachments column
      const attachmentsCell = document.createElement('td');
      if (result.attachments && result.attachments.length > 0) {
        const summary = result.attachments.map(a =>
          `${a.filename} (${(a.size/1024).toFixed(0)}KB)`
        ).join(', ');
        attachmentsCell.textContent = `${result.attachments.length}: ${summary}`;
        attachmentsCell.title = summary;
        attachmentsCell.style.maxWidth = '200px';
        attachmentsCell.style.overflow = 'hidden';
        attachmentsCell.style.textOverflow = 'ellipsis';
      } else {
        attachmentsCell.textContent = 'None';
        attachmentsCell.style.color = '#9ca3af';
      }
      row.appendChild(attachmentsCell);

      // Reason column
      const reasonCell = document.createElement('td');
      reasonCell.textContent = result.step2_reason || result.reason || 'Clinical lab result identified';
      reasonCell.style.maxWidth = '280px';
      reasonCell.style.overflow = 'hidden';
      reasonCell.style.textOverflow = 'ellipsis';
      reasonCell.title = result.step2_reason || result.reason;
      row.appendChild(reasonCell);

      resultsTbody.appendChild(row);
    });
  }

  // Populate Step-1 Candidates debug table
  const step1Candidates = debug.step1_candidates || [];
  document.getElementById('step1-candidates-count').textContent = step1Candidates.length;
  const step1Tbody = document.getElementById('step1-candidates-tbody');
  step1Tbody.innerHTML = '';

  step1Candidates.forEach(candidate => {
    const row = document.createElement('tr');

    // ID
    const idCell = document.createElement('td');
    idCell.textContent = candidate.id.substring(0, 12) + '...';
    idCell.title = candidate.id;
    idCell.style.fontFamily = 'monospace';
    idCell.style.fontSize = '12px';
    row.appendChild(idCell);

    // Subject
    const subjectCell = document.createElement('td');
    subjectCell.textContent = candidate.subject || '(no subject)';
    subjectCell.style.maxWidth = '250px';
    subjectCell.style.overflow = 'hidden';
    subjectCell.style.textOverflow = 'ellipsis';
    subjectCell.title = candidate.subject;
    row.appendChild(subjectCell);

    // From
    const fromCell = document.createElement('td');
    fromCell.textContent = candidate.from || '(unknown)';
    fromCell.style.maxWidth = '180px';
    fromCell.style.overflow = 'hidden';
    fromCell.style.textOverflow = 'ellipsis';
    fromCell.title = candidate.from;
    row.appendChild(fromCell);

    // Date
    const dateCell = document.createElement('td');
    const date = new Date(candidate.date);
    if (!isNaN(date)) {
      dateCell.textContent = date.toLocaleDateString();
      dateCell.title = date.toLocaleString();
    } else {
      dateCell.textContent = candidate.date ? candidate.date.substring(0, 16) : '';
    }
    row.appendChild(dateCell);

    // Step-1 Confidence
    const confCell = document.createElement('td');
    confCell.textContent = `${(candidate.step1_confidence * 100).toFixed(0)}%`;
    row.appendChild(confCell);

    // Step-1 Reason
    const reasonCell = document.createElement('td');
    reasonCell.textContent = candidate.step1_reason || 'Unknown';
    reasonCell.style.maxWidth = '300px';
    reasonCell.style.overflow = 'hidden';
    reasonCell.style.textOverflow = 'ellipsis';
    reasonCell.title = candidate.step1_reason;
    row.appendChild(reasonCell);

    step1Tbody.appendChild(row);
  });

  // Populate Step-2 All Results debug table
  const step2AllResults = debug.step2_all_results || [];
  document.getElementById('step2-all-count').textContent = step2AllResults.length;
  const step2AllTbody = document.getElementById('step2-all-tbody');
  step2AllTbody.innerHTML = '';

  step2AllResults.forEach(item => {
    const row = document.createElement('tr');

    // Status
    const statusCell = document.createElement('td');
    if (item.accepted) {
      statusCell.innerHTML = '<span style="color: #16a34a; font-weight: 600;">✅ Accepted</span>';
    } else {
      statusCell.innerHTML = '<span style="color: #dc2626; font-weight: 600;">❌ Rejected</span>';
      row.style.background = '#fee2e2';
    }
    row.appendChild(statusCell);

    // ID
    const idCell = document.createElement('td');
    idCell.textContent = item.id.substring(0, 12) + '...';
    idCell.title = item.id;
    idCell.style.fontFamily = 'monospace';
    idCell.style.fontSize = '12px';
    row.appendChild(idCell);

    // Subject
    const subjectCell = document.createElement('td');
    subjectCell.textContent = item.subject || '(no subject)';
    subjectCell.style.maxWidth = '200px';
    subjectCell.style.overflow = 'hidden';
    subjectCell.style.textOverflow = 'ellipsis';
    subjectCell.title = item.subject;
    row.appendChild(subjectCell);

    // From
    const fromCell = document.createElement('td');
    fromCell.textContent = item.from || '(unknown)';
    fromCell.style.maxWidth = '150px';
    fromCell.style.overflow = 'hidden';
    fromCell.style.textOverflow = 'ellipsis';
    fromCell.title = item.from;
    row.appendChild(fromCell);

    // Step-2 Clinical?
    const clinicalCell = document.createElement('td');
    clinicalCell.textContent = item.step2_is_clinical ? 'Yes' : 'No';
    clinicalCell.style.color = item.step2_is_clinical ? '#16a34a' : '#dc2626';
    clinicalCell.style.fontWeight = '600';
    row.appendChild(clinicalCell);

    // Step-2 Confidence
    const confCell = document.createElement('td');
    confCell.textContent = `${(item.step2_confidence * 100).toFixed(0)}%`;
    if (item.step2_confidence >= threshold) {
      confCell.style.color = '#16a34a';
      confCell.style.fontWeight = '600';
    } else {
      confCell.style.color = '#dc2626';
    }
    row.appendChild(confCell);

    // Step-2 Reason
    const reasonCell = document.createElement('td');
    reasonCell.textContent = item.step2_reason || 'Unknown';
    reasonCell.style.maxWidth = '300px';
    reasonCell.style.overflow = 'hidden';
    reasonCell.style.textOverflow = 'ellipsis';
    reasonCell.title = item.step2_reason;
    row.appendChild(reasonCell);

    step2AllTbody.appendChild(row);
  });

  resultsContainer.hidden = false;
}

/**
 * Event Listeners
 */
connectBtn.addEventListener('click', connectGmail);
fetchBtn.addEventListener('click', fetchAndClassify);

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  checkStatus();
});
