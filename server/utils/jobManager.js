/**
 * Job Manager for Async Lab Report Processing
 *
 * Handles long-running lab report analysis jobs to avoid Cloudflare timeouts.
 * Jobs are stored in memory with automatic cleanup after 1 hour.
 */

const jobs = new Map();
const batches = new Map();

// Job statuses
const JobStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Automatic cleanup of old jobs and batches (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);

  // Clean up old jobs
  for (const [jobId, job] of jobs.entries()) {
    if (job.createdAt < oneHourAgo) {
      jobs.delete(jobId);
      console.log(`[JobManager] Cleaned up old job: ${jobId}`);
    }
  }

  // Clean up old batches
  for (const [batchId, batch] of batches.entries()) {
    if (batch.createdAt < oneHourAgo) {
      batches.delete(batchId);
      console.log(`[JobManager] Cleaned up old batch: ${batchId}`);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

/**
 * Create a new job
 * @param {string} userId - User ID who initiated the job
 * @param {object} metadata - Additional job metadata
 * @returns {string} jobId
 */
function createJob(userId, metadata = {}) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  jobs.set(jobId, {
    jobId,
    userId,
    status: JobStatus.PENDING,
    progress: 0,
    result: null,
    error: null,
    metadata,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null
  });

  console.log(`[JobManager] Created job: ${jobId}`);
  return jobId;
}

/**
 * Update job status
 * @param {string} jobId - Job ID
 * @param {string} status - New status
 * @param {object} updates - Additional fields to update
 */
function updateJob(jobId, status, updates = {}) {
  const job = jobs.get(jobId);
  if (!job) {
    console.error(`[JobManager] Job not found: ${jobId}`);
    return false;
  }

  // Guard: Don't allow non-terminal states to overwrite terminal states
  // This prevents race conditions where background tasks update FAILED/COMPLETED jobs
  if ((job.status === JobStatus.FAILED || job.status === JobStatus.COMPLETED) &&
      (status !== JobStatus.FAILED && status !== JobStatus.COMPLETED)) {
    console.warn(
      `[JobManager] Ignoring status update ${status} for job ${jobId} - ` +
      `job is already in terminal state: ${job.status}`
    );
    return false;
  }

  const updatedJob = {
    ...job,
    status,
    updatedAt: Date.now(),
    ...updates
  };

  if (status === JobStatus.PROCESSING && !job.startedAt) {
    updatedJob.startedAt = Date.now();
  }

  if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
    updatedJob.completedAt = Date.now();
    updatedJob.progress = 100;
  }

  jobs.set(jobId, updatedJob);
  console.log(`[JobManager] Updated job ${jobId}: ${status}`);
  return true;
}

/**
 * Update job progress
 * @param {string} jobId - Job ID
 * @param {number} progress - Progress percentage (0-100)
 * @param {string} message - Optional progress message
 */
function updateProgress(jobId, progress, message = null) {
  const job = jobs.get(jobId);
  if (!job) return false;

  // Guard: Don't update progress on terminal jobs (race condition protection)
  if (job.status === JobStatus.FAILED || job.status === JobStatus.COMPLETED) {
    console.warn(
      `[JobManager] Ignoring progress update for job ${jobId} - ` +
      `job is in terminal state: ${job.status}`
    );
    return false;
  }

  jobs.set(jobId, {
    ...job,
    progress,
    progressMessage: message,
    updatedAt: Date.now()
  });

  if (message) {
    console.log(`[JobManager] Job ${jobId} progress: ${progress}% - ${message}`);
  }

  return true;
}

/**
 * Set job result
 * @param {string} jobId - Job ID
 * @param {object} result - Job result data
 */
function setJobResult(jobId, result) {
  return updateJob(jobId, JobStatus.COMPLETED, { result });
}

/**
 * Set job error
 * @param {string} jobId - Job ID
 * @param {Error|string} error - Error object or message
 */
function setJobError(jobId, error) {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : null;

  return updateJob(jobId, JobStatus.FAILED, {
    error: errorMessage,
    errorStack
  });
}

/**
 * Get job by ID
 * @param {string} jobId - Job ID
 * @returns {object|null} Job object or null if not found
 */
function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Get job status (public-safe version without internal details)
 * @param {string} jobId - Job ID
 * @returns {object|null} Public job status or null if not found
 */
function getJobStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    result: job.status === JobStatus.COMPLETED ? job.result : null,
    error: job.status === JobStatus.FAILED ? job.error : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  };
}

/**
 * Check if job exists
 * @param {string} jobId - Job ID
 * @returns {boolean}
 */
function jobExists(jobId) {
  return jobs.has(jobId);
}

/**
 * Delete job
 * @param {string} jobId - Job ID
 * @returns {boolean} True if deleted, false if not found
 */
function deleteJob(jobId) {
  return jobs.delete(jobId);
}

/**
 * Get all jobs for a user
 * @param {string} userId - User ID
 * @returns {array} Array of jobs
 */
function getUserJobs(userId) {
  return Array.from(jobs.values()).filter(job => job.userId === userId);
}

/**
 * Create a new batch of jobs
 * @param {string} userId - User ID who initiated the batch
 * @param {array} files - Array of file objects with {name, data, mimetype, size}
 * @returns {object} { batchId, jobs, files: filesWithJobIds }
 */
function createBatch(userId, files) {
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const jobs = files.map(file => {
    const jobId = createJob(userId, {
      filename: file.name,
      batchId
    });
    return {
      jobId,
      filename: file.name,
      status: 'pending'
    };
  });

  // Persist jobId on the uploaded file objects so downstream workers can
  // report status updates against the right job records.
  const filesWithJobIds = files.map((file, index) => ({
    ...file,
    jobId: jobs[index].jobId
  }));

  batches.set(batchId, {
    batchId,
    userId,
    jobs,
    files: filesWithJobIds,
    createdAt: Date.now()
  });

  console.log(`[JobManager] Created batch: ${batchId} with ${jobs.length} jobs`);
  return { batchId, jobs, files: filesWithJobIds };
}

/**
 * Get batch status
 * @param {string} batchId - Batch ID
 * @returns {object|null} Batch status or null if not found
 */
function getBatchStatus(batchId) {
  const batch = batches.get(batchId);
  if (!batch) return null;

  const jobsWithStatus = batch.jobs.map(({ jobId, filename }) => {
    const job = getJobStatus(jobId);
    return {
      job_id: jobId,
      filename,
      status: job?.status || 'pending',
      progress: job?.progress || 0,
      progress_message: job?.progressMessage || '',
      report_id: job?.result?.report_id || null,
      error: job?.error || null
    };
  });

  const completedJobs = jobsWithStatus.filter(j => j.status === 'completed' || j.status === 'failed');

  return {
    batch_id: batchId,
    total_count: batch.jobs.length,
    completed_count: completedJobs.length,
    all_complete: completedJobs.length === batch.jobs.length,
    jobs: jobsWithStatus
  };
}

/**
 * Get batch by ID
 * @param {string} batchId - Batch ID
 * @returns {object|null} Batch object or null if not found
 */
function getBatch(batchId) {
  return batches.get(batchId) || null;
}

export {
  JobStatus,
  createJob,
  updateJob,
  updateProgress,
  setJobResult,
  setJobError,
  getJob,
  getJobStatus,
  jobExists,
  deleteJob,
  getUserJobs,
  createBatch,
  getBatchStatus,
  getBatch
};
