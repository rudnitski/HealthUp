/**
 * Gmail Dev UI
 * Client-side logic for Gmail integration developer interface
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step1.md
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
const resultsCount = document.getElementById('results-count');
const likelyCount = document.getElementById('likely-count');
const resultsTable = document.getElementById('results-table');
const resultsTbody = document.getElementById('results-tbody');
const filterLikely = document.getElementById('filter-likely');

// Toast container
const toastContainer = document.getElementById('toast-container');

// State
let currentResults = [];
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
  const maxAttempts = 150; // 5 minutes max (150 * 2 seconds)

  pollInterval = setInterval(async () => {
    attempts++;

    try {
      const response = await fetch(`/api/dev-gmail/jobs/${jobId}`);

      if (!response.ok) {
        throw new Error('Failed to get job status');
      }

      const job = await response.json();

      console.log('Job status:', job.status);

      if (job.status === 'completed') {
        clearInterval(pollInterval);
        jobLoading.hidden = true;
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch & Classify Emails';

        const results = job.result?.results || [];

        if (results.length === 0) {
          resultsEmpty.hidden = false;
        } else {
          currentResults = results;
          displayResults(results);
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
        jobErrorMessage.textContent = 'Job timed out after 5 minutes. The job may still be running in the background.';
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
 * Display classification results
 */
function displayResults(results) {
  currentResults = results;

  const likelyResults = results.filter(r => r.is_lab_likely);

  resultsCount.textContent = results.length;
  likelyCount.textContent = likelyResults.length;

  // Apply filter
  const displayResults = filterLikely.checked ? likelyResults : results;

  // Clear table
  resultsTbody.innerHTML = '';

  // Populate table
  displayResults.forEach(result => {
    const row = document.createElement('tr');

    // Subject
    const subjectCell = document.createElement('td');
    subjectCell.textContent = result.subject || '(no subject)';
    subjectCell.style.maxWidth = '300px';
    subjectCell.style.overflow = 'hidden';
    subjectCell.style.textOverflow = 'ellipsis';
    subjectCell.style.whiteSpace = 'nowrap';
    subjectCell.title = result.subject;
    row.appendChild(subjectCell);

    // Sender
    const senderCell = document.createElement('td');
    senderCell.textContent = result.from || '(unknown)';
    senderCell.style.maxWidth = '200px';
    senderCell.style.overflow = 'hidden';
    senderCell.style.textOverflow = 'ellipsis';
    senderCell.style.whiteSpace = 'nowrap';
    senderCell.title = result.from;
    row.appendChild(senderCell);

    // Date
    const dateCell = document.createElement('td');
    const date = new Date(result.date);
    if (!isNaN(date)) {
      dateCell.textContent = date.toLocaleDateString();
      dateCell.title = date.toLocaleString();
    } else {
      dateCell.textContent = result.date ? result.date.substring(0, 16) : '';
    }
    row.appendChild(dateCell);

    // Verdict
    const verdictCell = document.createElement('td');
    if (result.is_lab_likely) {
      verdictCell.innerHTML = '<span style="color: #16a34a; font-weight: 600;">🟢 Likely</span>';
    } else {
      verdictCell.innerHTML = '<span style="color: #9ca3af;">⚪ Unlikely</span>';
    }
    row.appendChild(verdictCell);

    // Confidence
    const confidenceCell = document.createElement('td');
    const confidence = (result.confidence * 100).toFixed(0);
    confidenceCell.textContent = confidence + '%';
    if (result.confidence >= 0.8) {
      confidenceCell.style.color = '#16a34a';
      confidenceCell.style.fontWeight = '600';
    } else if (result.confidence >= 0.5) {
      confidenceCell.style.color = '#f59e0b';
    } else {
      confidenceCell.style.color = '#9ca3af';
    }
    row.appendChild(confidenceCell);

    // Reason
    const reasonCell = document.createElement('td');
    reasonCell.textContent = result.reason || 'N/A';
    reasonCell.style.maxWidth = '400px';
    reasonCell.style.overflow = 'hidden';
    reasonCell.style.textOverflow = 'ellipsis';
    reasonCell.style.whiteSpace = 'nowrap';
    reasonCell.title = result.reason;
    row.appendChild(reasonCell);

    resultsTbody.appendChild(row);
  });

  resultsContainer.hidden = false;
}

/**
 * Handle filter checkbox change
 */
filterLikely.addEventListener('change', () => {
  if (currentResults.length > 0) {
    displayResults(currentResults);
  }
});

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
