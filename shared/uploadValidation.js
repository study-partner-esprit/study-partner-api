/**
 * Shared upload validation (INGEST-01).
 *
 * Uploaded course files are validated by extension, declared content type AND
 * magic-byte sniffing — content type alone is never trusted (audit §7.9,
 * `courses.js:29–44`). Scripts/executables disguised with a document extension
 * are rejected before any parsing happens.
 *
 * Mirrors the Python ingestion worker contract (`workers/schemas.py` UploadFile):
 * allowed types and limits MUST stay identical on both sides.
 */

const path = require('path');

/** Allowed types mapped by declared MIME → accepted extensions. */
const ALLOWED_TYPES = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.md']
};

/** Reasonable header-read size for magic-byte sniffing (PDF header is tiny). */
const SNIFF_BYTES = 512;

/** Binary/executable magic byte signatures we reject outright. */
const BINARY_MAGICS = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x4d, 0x5a], // MZ (Windows PE / DOS)
  [0x50, 0x4b, 0x03, 0x04], // ZIP (and Office docs we don't parse)
  [0x1f, 0x8b], // gzip
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] // xz
];

/** Script/executable text signatures we reject (disguised documents). */
const SCRIPT_MAGICS = [
  [0x23, 0x21], // #! shebang
  [0x3c, 0x3f, 0x70, 0x68, 0x70] // <?php
];

/**
 * Sniff the real content type of a buffer.
 * @returns {'pdf'|'text'|'binary'}
 */
function sniffMagicBytes(buffer) {
  const head = buffer.subarray(0, SNIFF_BYTES);
  if (head.length >= 5) {
    // %PDF-
    const pdfMagic = [0x25, 0x50, 0x44, 0x46, 0x2d];
    if (pdfMagic.every((b, i) => head[i] === b)) return 'pdf';
  }

  for (const sig of BINARY_MAGICS) {
    if (head.length >= sig.length && sig.every((b, i) => head[i] === b)) return 'binary';
  }
  for (const sig of SCRIPT_MAGICS) {
    if (head.length >= sig.length && sig.every((b, i) => head[i] === b)) return 'binary';
  }

  // Text files must not contain NUL bytes in the header region.
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return 'binary';
  }

  return 'text';
}

/**
 * Validate file metadata only (declared MIME + extension). Cheap first pass —
 * usable inside a multer fileFilter where content buffers are not available.
 *
 * @param {{ originalname?: string, mimetype?: string }} meta
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateUploadMetadata(meta) {
  const errors = [];
  const { originalname = '', mimetype = '' } = meta;

  const ext = (path.extname(originalname) || '').toLowerCase();
  const allowedExts = ALLOWED_TYPES[mimetype];
  if (!allowedExts) {
    errors.push(`unsupported file type "${mimetype}"`);
    return { valid: false, errors };
  }
  if (!allowedExts.includes(ext)) {
    errors.push(`extension "${ext || '(none)'}" is not allowed for ${mimetype}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate metadata AND actual content (magic bytes). Always prefer this for
 * the authoritative check once the upload body is available.
 *
 * @param {{ originalname?: string, mimetype?: string, buffer?: Buffer }} file
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateUploadFile(file) {
  const meta = validateUploadMetadata(file);
  const errors = [...meta.errors];
  if (meta.valid) {
    const { buffer, mimetype } = file;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      errors.push('file content is missing or empty');
    } else {
      const sniffed = sniffMagicBytes(buffer);
      if (sniffed === 'binary') {
        errors.push('file content looks like a binary/script and is not an allowed document');
      } else if (mimetype === 'application/pdf' && sniffed !== 'pdf') {
        errors.push('declared application/pdf but content is not a PDF');
      } else if (mimetype === 'text/plain' && sniffed === 'pdf') {
        errors.push('declared text/plain but content is a PDF');
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an array of uploaded files. Returns the first failing file name.
 *
 * @param {Array<{originalname?: string, mimetype?: string, buffer?: Buffer}>} files
 */
function validateUploadFiles(files = []) {
  for (const file of files) {
    const check = validateUploadFile(file);
    if (!check.valid) {
      return { valid: false, file: file.originalname || '(unnamed)', errors: check.errors };
    }
  }
  return { valid: true, file: null, errors: [] };
}

module.exports = {
  ALLOWED_TYPES,
  SNIFF_BYTES,
  validateUploadMetadata,
  validateUploadFile,
  validateUploadFiles,
  sniffMagicBytes
};
