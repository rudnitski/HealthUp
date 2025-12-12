// public/js/admin.js
// PRD v2.4: Admin panel JavaScript for pending analytes and ambiguous matches

// State
let pendingAnalytes = [];
let ambiguousMatches = [];

// DOM Elements
const tabButtons = document.querySelectorAll('.admin-tab');
const tabContents = document.querySelectorAll('.tab-content');
const navPendingCount = document.getElementById('nav-pending-count');

// New Analytes Tab
const loadingNew = document.getElementById('loading-new');
const emptyNew = document.getElementById('empty-new');
const errorNew = document.getElementById('error-new');
const tableNewWrapper = document.getElementById('table-new-wrapper');
const tableNew = document.getElementById('table-new');
const tbodyNew = document.getElementById('tbody-new');
const newCount = document.getElementById('new-count');

// Ambiguous Matches Tab
const loadingAmbiguous = document.getElementById('loading-ambiguous');
const emptyAmbiguous = document.getElementById('empty-ambiguous');
const errorAmbiguous = document.getElementById('error-ambiguous');
const tableAmbiguousWrapper = document.getElementById('table-ambiguous-wrapper');
const tableAmbiguous = document.getElementById('table-ambiguous');
const tbodyAmbiguous = document.getElementById('tbody-ambiguous');
const ambiguousCount = document.getElementById('ambiguous-count');

// Modals
const detailsModal = document.getElementById('details-modal');
const confirmModal = document.getElementById('confirm-modal');
const toastContainer = document.getElementById('toast-container');

// Tab Switching
tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  // Update active tab button
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update visible tab content
  tabContents.forEach(content => {
    if (content.id === `content-${tab}`) {
      content.classList.add('active');
      content.hidden = false;
    } else {
      content.classList.remove('active');
      content.hidden = true;
    }
  });
}

// Toast Notifications
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

// Confirmation Dialog
// Options: { requireText: 'RESET' } - if set, user must type this exact text to confirm
function confirm(title, message, options = {}) {
  return new Promise((resolve) => {
    const confirmTitle = document.getElementById('confirm-title');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmInput = document.getElementById('confirm-input');
    const confirmYes = document.getElementById('confirm-yes');
    const confirmNo = document.getElementById('confirm-no');

    confirmTitle.textContent = title;
    confirmMessage.textContent = message;

    let handleInput = null;

    // Show input field if text confirmation is required
    if (options.requireText) {
      confirmInput.hidden = false;
      confirmInput.value = '';
      confirmInput.placeholder = `Type "${options.requireText}" to confirm`;
      confirmInput.classList.remove('invalid');
      confirmYes.disabled = true;

      handleInput = () => {
        const matches = confirmInput.value === options.requireText;
        confirmYes.disabled = !matches;
        if (confirmInput.value && !matches) {
          confirmInput.classList.add('invalid');
        } else {
          confirmInput.classList.remove('invalid');
        }
      };

      confirmInput.addEventListener('input', handleInput);
      setTimeout(() => confirmInput.focus(), 100);
    } else {
      confirmInput.hidden = true;
      confirmYes.disabled = false;
    }

    confirmModal.hidden = false;

    const handleYes = () => {
      if (options.requireText && confirmInput.value !== options.requireText) {
        confirmInput.classList.add('invalid');
        return;
      }
      cleanup();
      resolve(true);
    };

    const handleNo = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      confirmYes.removeEventListener('click', handleYes);
      confirmNo.removeEventListener('click', handleNo);
      if (handleInput) {
        confirmInput.removeEventListener('input', handleInput);
      }
      confirmModal.hidden = true;
      confirmInput.value = '';
      confirmInput.classList.remove('invalid');
      confirmYes.disabled = false;
    };

    confirmYes.addEventListener('click', handleYes);
    confirmNo.addEventListener('click', handleNo);
  });
}

// Fetch Pending Analytes
async function fetchPendingAnalytes() {
  loadingNew.hidden = false;
  errorNew.hidden = true;
  tableNewWrapper.hidden = true;
  tableNew.hidden = true;
  emptyNew.hidden = true;

  try {
    const response = await fetch('/api/admin/pending-analytes?status=pending');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    pendingAnalytes = data.pending || [];
    newCount.textContent = pendingAnalytes.length;
    if (navPendingCount) {
      if (pendingAnalytes.length > 0) {
        navPendingCount.textContent = pendingAnalytes.length;
        navPendingCount.hidden = false;
      } else {
        navPendingCount.hidden = true;
      }
    }

    renderPendingAnalytes();
  } catch (error) {
    console.error('Failed to fetch pending analytes:', error);
    errorNew.querySelector('.error-message').textContent = `Error: ${error.message}`;
    errorNew.hidden = false;
  } finally {
    loadingNew.hidden = true;
  }
}

// Render Pending Analytes Table
function renderPendingAnalytes() {
  tbodyNew.innerHTML = '';

  if (pendingAnalytes.length === 0) {
    emptyNew.hidden = false;
    tableNewWrapper.hidden = true;
    tableNew.hidden = true;
    return;
  }

  emptyNew.hidden = true;
  tableNewWrapper.hidden = false;
  tableNew.hidden = false;

  pendingAnalytes.forEach(analyte => {
    const row = document.createElement('tr');
    row.className = 'admin-row';

    const variationsCount = analyte.parameter_variations?.length || 0;
    const createdAt = new Date(analyte.created_at).toLocaleDateString();

    row.innerHTML = `
      <td class="code-cell">${escapeHtml(analyte.proposed_code)}</td>
      <td>${escapeHtml(analyte.proposed_name)}</td>
      <td><span class="category-badge">${escapeHtml(analyte.category || 'uncategorized')}</span></td>
      <td>${escapeHtml(analyte.unit_canonical || '—')}</td>
      <td><span class="confidence-badge">${(analyte.confidence * 100).toFixed(0)}%</span></td>
      <td>${variationsCount} variations</td>
      <td>${createdAt}</td>
      <td class="actions-cell">
        <button class="action-btn approve-btn" data-id="${analyte.pending_id}">✅ Approve</button>
        <button class="action-btn discard-btn" data-id="${analyte.pending_id}">❌ Discard</button>
        <button class="action-btn details-btn" data-id="${analyte.pending_id}">👁️ Details</button>
      </td>
    `;

    tbodyNew.appendChild(row);
  });

  // Add event listeners
  document.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', () => handleApprove(btn.dataset.id));
  });

  document.querySelectorAll('.discard-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDiscard(btn.dataset.id));
  });

  document.querySelectorAll('.details-btn').forEach(btn => {
    btn.addEventListener('click', () => showAnalyteDetails(btn.dataset.id));
  });
}

// Fetch Ambiguous Matches
async function fetchAmbiguousMatches() {
  loadingAmbiguous.hidden = false;
  errorAmbiguous.hidden = true;
  tableAmbiguousWrapper.hidden = true;
  tableAmbiguous.hidden = true;
  emptyAmbiguous.hidden = true;

  try {
    const response = await fetch('/api/admin/ambiguous-matches?status=pending');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    ambiguousMatches = data.ambiguous || [];
    ambiguousCount.textContent = ambiguousMatches.length;

    renderAmbiguousMatches();
  } catch (error) {
    console.error('Failed to fetch ambiguous matches:', error);
    errorAmbiguous.querySelector('.error-message').textContent = `Error: ${error.message}`;
    errorAmbiguous.hidden = false;
  } finally {
    loadingAmbiguous.hidden = true;
  }
}

// Render Ambiguous Matches Table
function renderAmbiguousMatches() {
  tbodyAmbiguous.innerHTML = '';

  if (ambiguousMatches.length === 0) {
    emptyAmbiguous.hidden = false;
    tableAmbiguousWrapper.hidden = true;
    tableAmbiguous.hidden = true;
    return;
  }

  emptyAmbiguous.hidden = true;
  tableAmbiguousWrapper.hidden = false;
  tableAmbiguous.hidden = false;

  ambiguousMatches.forEach(match => {
    const row = document.createElement('tr');
    row.className = 'admin-row';

    const candidates = match.candidates || [];
    const candidatesText = candidates.length > 0
      ? candidates.map(c => `${c.code || c.analyte_id} (${(c.similarity * 100).toFixed(0)}%)`).join(', ')
      : 'None';

    const createdAt = new Date(match.created_at).toLocaleDateString();

    row.innerHTML = `
      <td>${escapeHtml(match.raw_parameter_name)}</td>
      <td>${escapeHtml(match.unit || '—')}</td>
      <td>${escapeHtml(candidatesText)}</td>
      <td>${createdAt}</td>
      <td class="actions-cell">
        <button class="action-btn resolve-btn" data-id="${match.review_id}">Choose</button>
        <button class="action-btn discard-btn" data-id="${match.review_id}">❌ Discard</button>
      </td>
    `;

    tbodyAmbiguous.appendChild(row);
  });

  // Add event listeners
  document.querySelectorAll('.resolve-btn').forEach(btn => {
    btn.addEventListener('click', () => showResolveDialog(btn.dataset.id));
  });

  document.querySelectorAll('#tbody-ambiguous .discard-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDiscardAmbiguous(btn.dataset.id));
  });
}

// Handle Approve
async function handleApprove(pendingId) {
  const analyte = pendingAnalytes.find(a => a.pending_id == pendingId);
  if (!analyte) return;

  const confirmed = await confirm(
    'Approve Analyte',
    `Approve analyte "${analyte.proposed_code}" (${analyte.proposed_name})? This will create a new canonical analyte and backfill matching lab results.`
  );

  if (!confirmed) return;

  try {
    const response = await fetch('/api/admin/approve-analyte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending_id: pendingId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const result = await response.json();
    showToast(`✅ Analyte approved! ${result.backfilled_rows} lab results updated.`, 'success');

    // Refresh the table
    await fetchPendingAnalytes();
  } catch (error) {
    console.error('Failed to approve analyte:', error);
    showToast(`❌ Error: ${error.message}`, 'error');
  }
}

// Handle Discard
async function handleDiscard(pendingId) {
  const analyte = pendingAnalytes.find(a => a.pending_id == pendingId);
  if (!analyte) return;

  const reason = prompt(
    `Discard analyte "${analyte.proposed_code}"?\n\nOptional: Enter reason for discarding (to prevent re-proposing):`
  );

  if (reason === null) return; // User cancelled

  try {
    const response = await fetch('/api/admin/discard-analyte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending_id: pendingId, reason })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    showToast('✅ Analyte discarded', 'success');

    // Refresh the table
    await fetchPendingAnalytes();
  } catch (error) {
    console.error('Failed to discard analyte:', error);
    showToast(`❌ Error: ${error.message}`, 'error');
  }
}

// Show Analyte Details in Modal
function showAnalyteDetails(pendingId) {
  const analyte = pendingAnalytes.find(a => a.pending_id == pendingId);
  if (!analyte) return;

  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  modalTitle.textContent = `${analyte.proposed_code} — ${analyte.proposed_name}`;

  const variations = analyte.parameter_variations || [];
  const evidence = analyte.evidence || {};

  modalBody.innerHTML = `
    <h4>Parameter Variations (${variations.length})</h4>
    <ul>
      ${variations.map(v => `
        <li>
          <strong>${escapeHtml(v.raw)}</strong> (${v.lang || 'unknown'}, ${v.count || 1} occurrences)
          <br><em>Normalized:</em> ${escapeHtml(v.normalized || v.raw)}
        </li>
      `).join('')}
    </ul>

    <h4>Evidence</h4>
    <pre>${JSON.stringify(evidence, null, 2)}</pre>

    <h4>Metadata</h4>
    <p><strong>Category:</strong> ${escapeHtml(analyte.category || 'uncategorized')}</p>
    <p><strong>Unit:</strong> ${escapeHtml(analyte.unit_canonical || '—')}</p>
    <p><strong>Confidence:</strong> ${(analyte.confidence * 100).toFixed(1)}%</p>
    <p><strong>Created:</strong> ${new Date(analyte.created_at).toLocaleString()}</p>
  `;

  detailsModal.hidden = false;

  // Close modal on button click
  const closeBtn = detailsModal.querySelector('.modal-close');
  closeBtn.onclick = () => {
    detailsModal.hidden = true;
  };

  // Close modal on outside click
  detailsModal.onclick = (e) => {
    if (e.target === detailsModal) {
      detailsModal.hidden = true;
    }
  };
}

// Show Resolve Ambiguous Match Dialog
async function showResolveDialog(reviewId) {
  const match = ambiguousMatches.find(m => m.review_id == reviewId);
  if (!match) return;

  const candidates = match.candidates || [];
  if (candidates.length === 0) {
    showToast('No candidates available', 'error');
    return;
  }

  // Build choice message
  let message = `Choose the correct analyte for "${match.raw_parameter_name}":\n\n`;
  candidates.forEach((c, i) => {
    message += `${i + 1}. ${c.code || `ID ${c.analyte_id}`} — ${c.name || 'Unknown'} (${(c.similarity * 100).toFixed(0)}% similar)\n`;
  });

  const choice = prompt(message + '\nEnter the number of your choice (or cancel):');
  if (!choice) return;

  const choiceIndex = parseInt(choice) - 1;
  if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= candidates.length) {
    showToast('Invalid choice', 'error');
    return;
  }

  const chosen = candidates[choiceIndex];

  const createAlias = await confirm(
    'Create Alias?',
    `Create an alias "${match.raw_parameter_name}" for ${chosen.code || chosen.analyte_id} to prevent future ambiguity?`
  );

  try {
    const response = await fetch('/api/admin/resolve-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        review_id: reviewId,
        chosen_analyte_id: chosen.analyte_id,
        create_alias: createAlias
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const result = await response.json();
    showToast(
      `✅ Match resolved! Chose ${result.chosen_analyte.code}. ${result.alias_created ? 'Alias created.' : ''}`,
      'success'
    );

    // Refresh the table
    await fetchAmbiguousMatches();
  } catch (error) {
    console.error('Failed to resolve match:', error);
    showToast(`❌ Error: ${error.message}`, 'error');
  }
}

// Handle Discard Ambiguous Match
async function handleDiscardAmbiguous(reviewId) {
  const match = ambiguousMatches.find(m => m.review_id == reviewId);
  if (!match) return;

  const confirmed = await confirm(
    'Discard Ambiguous Match',
    `Discard the ambiguous match for "${match.raw_parameter_name}"? This will mark it as discarded and it won't appear in the review queue anymore.`
  );

  if (!confirmed) return;

  try {
    const response = await fetch('/api/admin/discard-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: reviewId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    showToast('✅ Ambiguous match discarded', 'success');

    // Refresh the table
    await fetchAmbiguousMatches();
  } catch (error) {
    console.error('Failed to discard match:', error);
    showToast(`❌ Error: ${error.message}`, 'error');
  }
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === DANGER ZONE FUNCTIONALITY ===

const resetDatabaseBtn = document.getElementById('reset-database-btn');
const resetStatus = document.getElementById('reset-status');

// Handle database reset
async function handleDatabaseReset() {
  const confirmed = await confirm(
    '⚠️ DANGER: Reset Database?',
    'This will DELETE ALL DATA in the database including:\n\n' +
    '• All uploaded lab reports\n' +
    '• All patient data\n' +
    '• All lab results and mappings\n' +
    '• All pending analytes and reviews\n\n' +
    'The database will be recreated with seed analytes and aliases.\n\n' +
    'This action CANNOT be undone!',
    { requireText: 'RESET' }
  );

  if (!confirmed) {
    return;
  }

  // Disable button and show loading state
  resetDatabaseBtn.disabled = true;
  resetDatabaseBtn.textContent = '🔄 Resetting...';
  resetStatus.hidden = false;
  resetStatus.className = 'status-message info';
  resetStatus.textContent = 'Dropping tables and recreating schema... Please wait.';

  try {
    const response = await fetch('/api/admin/reset-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || `HTTP ${response.status}`);
    }

    // Success
    resetStatus.className = 'status-message success';
    resetStatus.textContent = '✅ ' + result.message;
    showToast('✅ Database reset successfully!', 'success');

    // Refresh all tabs
    setTimeout(async () => {
      await fetchPendingAnalytes();
      await fetchAmbiguousMatches();
    }, 1000);

  } catch (error) {
    console.error('Database reset failed:', error);
    resetStatus.className = 'status-message error';
    resetStatus.textContent = '❌ Failed to reset database: ' + error.message;
    showToast(`❌ Reset failed: ${error.message}`, 'error');
  } finally {
    resetDatabaseBtn.disabled = false;
    resetDatabaseBtn.textContent = '🗑️ Reset Database';
  }
}

// Add event listener for danger zone button
if (resetDatabaseBtn) {
  resetDatabaseBtn.addEventListener('click', handleDatabaseReset);
}

// Initialize
async function init() {
  await fetchPendingAnalytes();
  await fetchAmbiguousMatches();
}

init();
