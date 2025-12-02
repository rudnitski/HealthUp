/**
 * Manual Test: Job Terminal State Guard
 *
 * Tests that updateJob() and updateProgress() correctly prevent
 * non-terminal states from overwriting FAILED/COMPLETED states.
 *
 * This test verifies the fix for the race condition where background
 * StreamingClassifier progress callbacks could overwrite FAILED status
 * back to PROCESSING.
 *
 * Run: node test/manual/test_job_terminal_state_guard.js
 */

import {
  JobStatus,
  createJob,
  updateJob,
  updateProgress,
  setJobError,
  setJobResult,
  getJob
} from '../../server/utils/jobManager.js';

console.log('=== Job Terminal State Guard Test ===\n');

// Test 1: Cannot overwrite FAILED with PROCESSING
console.log('Test 1: updateJob() should not overwrite FAILED status');
const job1 = createJob('test-user-1', { test: 'overwrite-failed' });
updateJob(job1, JobStatus.PROCESSING, { progress: 10 });
setJobError(job1, 'Simulated fetch error');
const beforeOverwrite = getJob(job1);
console.log(`  Before overwrite attempt: status=${beforeOverwrite.status}, error="${beforeOverwrite.error}"`);

// Attempt to overwrite (simulates background callback firing after error)
const overwriteResult = updateJob(job1, JobStatus.PROCESSING, { progress: 50 });
const afterOverwrite = getJob(job1);
console.log(`  After overwrite attempt: status=${afterOverwrite.status}, error="${afterOverwrite.error}"`);
console.log(`  updateJob() returned: ${overwriteResult} (should be false)`);

if (afterOverwrite.status === JobStatus.FAILED && overwriteResult === false) {
  console.log('  ✅ PASS: FAILED status protected\n');
} else {
  console.log('  ❌ FAIL: FAILED status was overwritten!\n');
  process.exit(1);
}

// Test 2: Cannot overwrite COMPLETED with PROCESSING
console.log('Test 2: updateJob() should not overwrite COMPLETED status');
const job2 = createJob('test-user-2', { test: 'overwrite-completed' });
updateJob(job2, JobStatus.PROCESSING, { progress: 10 });
setJobResult(job2, { report_id: 'test-report-123' });
const beforeOverwrite2 = getJob(job2);
console.log(`  Before overwrite attempt: status=${beforeOverwrite2.status}, result.report_id=${beforeOverwrite2.result.report_id}`);

const overwriteResult2 = updateJob(job2, JobStatus.PROCESSING, { progress: 50 });
const afterOverwrite2 = getJob(job2);
console.log(`  After overwrite attempt: status=${afterOverwrite2.status}, result.report_id=${afterOverwrite2.result?.report_id || 'null'}`);
console.log(`  updateJob() returned: ${overwriteResult2} (should be false)`);

if (afterOverwrite2.status === JobStatus.COMPLETED && overwriteResult2 === false) {
  console.log('  ✅ PASS: COMPLETED status protected\n');
} else {
  console.log('  ❌ FAIL: COMPLETED status was overwritten!\n');
  process.exit(1);
}

// Test 3: updateProgress() should not update FAILED jobs
console.log('Test 3: updateProgress() should not update FAILED jobs');
const job3 = createJob('test-user-3', { test: 'progress-on-failed' });
updateJob(job3, JobStatus.PROCESSING, { progress: 10 });
setJobError(job3, 'Simulated error');
const beforeProgress = getJob(job3);
console.log(`  Before progress update: status=${beforeProgress.status}, progress=${beforeProgress.progress}`);

const progressResult = updateProgress(job3, 75, 'Should not apply');
const afterProgress = getJob(job3);
console.log(`  After progress update: status=${afterProgress.status}, progress=${afterProgress.progress}`);
console.log(`  updateProgress() returned: ${progressResult} (should be false)`);

if (afterProgress.status === JobStatus.FAILED && afterProgress.progress === 100 && progressResult === false) {
  console.log('  ✅ PASS: Progress update on FAILED job blocked\n');
} else {
  console.log('  ❌ FAIL: Progress was updated on FAILED job!\n');
  process.exit(1);
}

// Test 4: updateProgress() should not update COMPLETED jobs
console.log('Test 4: updateProgress() should not update COMPLETED jobs');
const job4 = createJob('test-user-4', { test: 'progress-on-completed' });
updateJob(job4, JobStatus.PROCESSING, { progress: 10 });
setJobResult(job4, { report_id: 'test-report-456' });
const beforeProgress2 = getJob(job4);
console.log(`  Before progress update: status=${beforeProgress2.status}, progress=${beforeProgress2.progress}`);

const progressResult2 = updateProgress(job4, 50, 'Should not apply');
const afterProgress2 = getJob(job4);
console.log(`  After progress update: status=${afterProgress2.status}, progress=${afterProgress2.progress}`);
console.log(`  updateProgress() returned: ${progressResult2} (should be false)`);

if (afterProgress2.status === JobStatus.COMPLETED && afterProgress2.progress === 100 && progressResult2 === false) {
  console.log('  ✅ PASS: Progress update on COMPLETED job blocked\n');
} else {
  console.log('  ❌ FAIL: Progress was updated on COMPLETED job!\n');
  process.exit(1);
}

// Test 5: Allow FAILED → FAILED (re-setting error)
console.log('Test 5: Should allow terminal → terminal transitions');
const job5 = createJob('test-user-5', { test: 'terminal-to-terminal' });
setJobError(job5, 'First error');
const beforeUpdate = getJob(job5);
console.log(`  Before second error: error="${beforeUpdate.error}"`);

const updateResult = setJobError(job5, 'Second error (should apply)');
const afterUpdate = getJob(job5);
console.log(`  After second error: error="${afterUpdate.error}"`);
console.log(`  setJobError() returned: ${updateResult} (should be true)`);

if (afterUpdate.error === 'Second error (should apply)' && updateResult === true) {
  console.log('  ✅ PASS: Terminal → terminal transitions allowed\n');
} else {
  console.log('  ❌ FAIL: Terminal → terminal transitions blocked!\n');
  process.exit(1);
}

// Test 6: Normal PROCESSING → PROCESSING allowed
console.log('Test 6: Normal PROCESSING → PROCESSING should work');
const job6 = createJob('test-user-6', { test: 'normal-update' });
updateJob(job6, JobStatus.PROCESSING, { progress: 10 });
const before = getJob(job6);
console.log(`  Before update: progress=${before.progress}`);

const normalUpdateResult = updateJob(job6, JobStatus.PROCESSING, { progress: 50 });
const after = getJob(job6);
console.log(`  After update: progress=${after.progress}`);
console.log(`  updateJob() returned: ${normalUpdateResult} (should be true)`);

if (after.progress === 50 && normalUpdateResult === true) {
  console.log('  ✅ PASS: Normal updates still work\n');
} else {
  console.log('  ❌ FAIL: Normal updates broken!\n');
  process.exit(1);
}

console.log('=== All Tests Passed ✅ ===');
