// Reports Browser Module
const ReportsBrowser = {
  initialized: false,

  async init() {
    // ==================== AUTH CHECK (MUST BE FIRST) ====================
    // Wait for auth.js to complete authentication check before any API calls
    const isAuthenticated = await window.authReady;
    if (!isAuthenticated) {
      // Not authenticated - auth.js already redirected to login
      return;
    }

    this.bindEvents();
    await this.loadPatients();
    await this.loadReports();
  },

  bindEvents() {
    document.getElementById('reports-from-date').addEventListener('change', () => this.loadReports());
    document.getElementById('reports-to-date').addEventListener('change', () => this.loadReports());
    document.getElementById('reports-patient-filter').addEventListener('change', () => this.loadReports());
    document.getElementById('reports-clear-filters').addEventListener('click', () => this.clearFilters());
  },

  async loadPatients() {
    try {
      const response = await fetch('/api/reports/patients');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      const select = document.getElementById('reports-patient-filter');
      data.patients.forEach(patient => {
        const option = document.createElement('option');
        option.value = patient.id;
        // PRD v4.3: Use display_name (computed server-side, handles NULL full_name)
        option.textContent = patient.display_name || patient.full_name || 'Unnamed Patient';
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load patients:', error);
      // Show error to user
      const select = document.getElementById('reports-patient-filter');
      const errorOption = document.createElement('option');
      errorOption.textContent = 'Error loading patients';
      errorOption.disabled = true;
      select.appendChild(errorOption);
    }
  },

  async loadReports() {
    const fromDate = document.getElementById('reports-from-date').value;
    const toDate = document.getElementById('reports-to-date').value;
    const patientId = document.getElementById('reports-patient-filter').value;

    const params = new URLSearchParams();
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    if (patientId) params.append('patientId', patientId);

    try {
      const response = await fetch(`/api/reports?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      this.renderReports(data.reports);
      document.getElementById('reports-count').textContent = `${data.total} reports`;
    } catch (error) {
      console.error('Failed to load reports:', error);
      // Show error to user
      this.renderError('Failed to load reports. Please try again.');
    }
  },

  renderError(message) {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '';

    const errorRow = document.createElement('tr');
    const errorCell = document.createElement('td');
    errorCell.colSpan = 3;
    errorCell.className = 'empty-state error-state';
    errorCell.textContent = message;
    errorRow.appendChild(errorCell);
    tbody.appendChild(errorRow);

    document.getElementById('reports-count').textContent = '0 reports';
  },

  renderReports(reports) {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '';

    if (reports.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 3;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'No reports found';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    reports.forEach(report => {
      const row = document.createElement('tr');

      // Date cell - use effective_date from API (single source of truth)
      const dateCell = document.createElement('td');
      dateCell.textContent = report.effective_date;
      row.appendChild(dateCell);

      // Patient name cell (use textContent to prevent XSS)
      const patientCell = document.createElement('td');
      patientCell.textContent = report.patient_name || 'Unnamed Patient';
      patientCell.title = report.patient_name || 'Unnamed Patient'; // Tooltip for long names
      row.appendChild(patientCell);

      // Actions cell
      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions-cell';

      // View Data button
      const viewDataBtn = document.createElement('button');
      viewDataBtn.className = 'btn-small btn-primary';
      viewDataBtn.textContent = 'View Data';
      viewDataBtn.addEventListener('click', () => this.viewData(report.report_id));
      actionsCell.appendChild(viewDataBtn);

      // View Original button
      const viewOriginalBtn = document.createElement('button');
      viewOriginalBtn.className = 'btn-small btn-secondary';
      viewOriginalBtn.textContent = 'View Original';
      if (report.has_file) {
        viewOriginalBtn.addEventListener('click', () => this.viewOriginal(report.report_id));
      } else {
        viewOriginalBtn.disabled = true;
        viewOriginalBtn.title = 'Original file not available';
      }
      actionsCell.appendChild(viewOriginalBtn);

      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });
  },

  viewData(reportId) {
    // Open in new tab - reuses existing report view
    window.open(`/?reportId=${reportId}`, '_blank');
  },

  viewOriginal(reportId) {
    // Open original file in new tab
    window.open(`/api/reports/${reportId}/original-file`, '_blank');
  },

  clearFilters() {
    document.getElementById('reports-from-date').value = '';
    document.getElementById('reports-to-date').value = '';
    document.getElementById('reports-patient-filter').value = '';
    this.loadReports();
  }
};
