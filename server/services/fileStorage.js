const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);

/**
 * File storage service for lab report files
 * Stores files in filesystem with organized directory structure
 */

// Configuration
const STORAGE_BASE_PATH = process.env.FILE_STORAGE_PATH || path.join(__dirname, '../../storage/lab_reports');
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Ensure storage directory exists
 */
async function ensureStorageDirectory() {
  try {
    await stat(STORAGE_BASE_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await mkdir(STORAGE_BASE_PATH, { recursive: true });
      console.log(`[fileStorage] Created storage directory: ${STORAGE_BASE_PATH}`);
    } else {
      throw error;
    }
  }
}

/**
 * Generate organized file path based on patient ID and report ID
 * Format: {storage_base}/{patient_id}/{report_id}{extension}
 *
 * @param {string} patientId - UUID of patient
 * @param {string} reportId - UUID of report
 * @param {string} originalFilename - Original filename for extension
 * @returns {string} Relative file path
 */
function generateFilePath(patientId, reportId, originalFilename) {
  // Extract extension from original filename
  const ext = originalFilename ? path.extname(originalFilename) : '';

  // Organize by patient ID for easier management
  const relativePath = path.join(patientId, `${reportId}${ext}`);

  return relativePath;
}

/**
 * Get full absolute path for a relative file path
 * @param {string} relativePath - Relative path from storage base
 * @returns {string} Absolute file path
 */
function getAbsolutePath(relativePath) {
  return path.join(STORAGE_BASE_PATH, relativePath);
}

/**
 * Save file buffer to filesystem
 *
 * @param {Buffer} fileBuffer - File data
 * @param {string} patientId - UUID of patient
 * @param {string} reportId - UUID of report
 * @param {string} originalFilename - Original filename
 * @returns {Promise<string>} Relative file path
 */
async function saveFile(fileBuffer, patientId, reportId, originalFilename) {
  if (!Buffer.isBuffer(fileBuffer)) {
    throw new Error('File buffer must be a Buffer');
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`);
  }

  // Ensure base directory exists
  await ensureStorageDirectory();

  // Generate file path
  const relativePath = generateFilePath(patientId, reportId, originalFilename);
  const absolutePath = getAbsolutePath(relativePath);

  // Ensure patient subdirectory exists
  const patientDir = path.dirname(absolutePath);
  try {
    await stat(patientDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await mkdir(patientDir, { recursive: true });
    } else {
      throw error;
    }
  }

  // Write file
  await writeFile(absolutePath, fileBuffer);

  console.log(`[fileStorage] Saved file: ${relativePath} (${fileBuffer.length} bytes)`);

  return relativePath;
}

/**
 * Read file from filesystem
 *
 * @param {string} relativePath - Relative file path
 * @returns {Promise<Buffer>} File buffer
 */
async function readFile(relativePath) {
  if (!relativePath) {
    throw new Error('File path is required');
  }

  const absolutePath = getAbsolutePath(relativePath);

  try {
    await stat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File not found
    }
    throw error;
  }

  return fs.promises.readFile(absolutePath);
}

/**
 * Delete file from filesystem
 *
 * @param {string} relativePath - Relative file path
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteFile(relativePath) {
  if (!relativePath) {
    return false;
  }

  const absolutePath = getAbsolutePath(relativePath);

  try {
    await unlink(absolutePath);
    console.log(`[fileStorage] Deleted file: ${relativePath}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // File already doesn't exist
    }
    throw error;
  }
}

/**
 * Check if file exists
 *
 * @param {string} relativePath - Relative file path
 * @returns {Promise<boolean>} True if exists
 */
async function fileExists(relativePath) {
  if (!relativePath) {
    return false;
  }

  const absolutePath = getAbsolutePath(relativePath);

  try {
    await stat(absolutePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Get file stats
 *
 * @param {string} relativePath - Relative file path
 * @returns {Promise<Object|null>} File stats or null if not found
 */
async function getFileStats(relativePath) {
  if (!relativePath) {
    return null;
  }

  const absolutePath = getAbsolutePath(relativePath);

  try {
    const stats = await stat(absolutePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

module.exports = {
  saveFile,
  readFile,
  deleteFile,
  fileExists,
  getFileStats,
  getAbsolutePath,
  ensureStorageDirectory,
  STORAGE_BASE_PATH,
};
