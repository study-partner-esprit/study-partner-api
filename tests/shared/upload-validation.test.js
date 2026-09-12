/**
 * INGEST-01 — File validation (MIME + magic bytes) unit tests.
 */
const {
  validateUploadMetadata,
  validateUploadFile,
  validateUploadFiles,
  sniffMagicBytes,
  checkPdfStructure,
  printableTextRatio
} = require('../../shared/uploadValidation');

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF');
}

function textBuffer() {
  return Buffer.from('Introduction to calculus.\nDefinition of a limit.');
}

describe('sniffMagicBytes', () => {
  test('detects PDF via %PDF- header', () => {
    expect(sniffMagicBytes(pdfBuffer())).toBe('pdf');
  });

  test('detects plain text with no binary signatures', () => {
    expect(sniffMagicBytes(textBuffer())).toBe('text');
  });

  test('flags ELF binary as binary', () => {
    expect(sniffMagicBytes(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]))).toBe('binary');
  });

  test('flags MZ (Windows PE) as binary', () => {
    expect(sniffMagicBytes(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBe('binary');
  });

  test('flags shebang scripts as binary (rejected documents)', () => {
    expect(sniffMagicBytes(Buffer.from('#!/usr/bin/env bash\necho pwned\n'))).toBe('binary');
  });

  test('flags NUL-containing bytes as binary', () => {
    expect(sniffMagicBytes(Buffer.from([0x68, 0x00, 0x69, 0x00]))).toBe('binary');
  });
});

describe('validateUploadMetadata (multer fileFilter pass)', () => {
  test('accepts application/pdf with .pdf', () => {
    const r = validateUploadMetadata({ originalname: 'notes.pdf', mimetype: 'application/pdf' });
    expect(r.valid).toBe(true);
  });

  test('accepts text/plain with .txt and .md', () => {
    expect(validateUploadMetadata({ originalname: 'a.txt', mimetype: 'text/plain' }).valid).toBe(
      true
    );
    expect(validateUploadMetadata({ originalname: 'a.md', mimetype: 'text/plain' }).valid).toBe(
      true
    );
  });

  test('rejects unsupported MIME (e.g. application/x-msdownload)', () => {
    const r = validateUploadMetadata({
      originalname: 'evil.exe',
      mimetype: 'application/x-msdownload'
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('unsupported file type');
  });

  test('rejects extension/mime mismatch (.pdf declared text/plain)', () => {
    const r = validateUploadMetadata({ originalname: 'x.pdf', mimetype: 'text/plain' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('.pdf" is not allowed for text/plain');
  });

  test('rejects double-extension obfuscation (notes.pdf.txt → text/plain ok, .txt ok)', () => {
    // `.pdf.txt` is still a text file extension; but a `.txt` file whose content
    // is actually a PDF/executable must be caught by content sniffing instead.
    const r = validateUploadMetadata({ originalname: 'notes.pdf.txt', mimetype: 'text/plain' });
    expect(r.valid).toBe(true);
  });
});

describe('validateUploadFile (magic-byte sniffing)', () => {
  test('accepts a real PDF declared application/pdf', () => {
    const r = validateUploadFile({
      originalname: 'real.pdf',
      mimetype: 'application/pdf',
      buffer: pdfBuffer()
    });
    expect(r.valid).toBe(true);
  });

  test('accepts plain text declared text/plain', () => {
    const r = validateUploadFile({
      originalname: 'real.txt',
      mimetype: 'text/plain',
      buffer: textBuffer()
    });
    expect(r.valid).toBe(true);
  });

  test('rejects a PDF renamed to .txt (content mismatch)', () => {
    const r = validateUploadFile({
      originalname: 'disguised.txt',
      mimetype: 'text/plain',
      buffer: pdfBuffer()
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('content is a PDF');
  });

  test('rejects an executable renamed to .pdf', () => {
    const r = validateUploadFile({
      originalname: 'evil.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('binary/script');
  });

  test('rejects a shell script renamed to .txt', () => {
    const r = validateUploadFile({
      originalname: 'backdoor.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('#!/bin/sh\nrm -rf /\n')
    });
    expect(r.valid).toBe(false);
  });

  test('rejects missing/empty content', () => {
    expect(validateUploadFile({ originalname: 'x.pdf', mimetype: 'application/pdf' }).valid).toBe(
      false
    );
    expect(
      validateUploadFile({
        originalname: 'x.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(0)
      }).valid
    ).toBe(false);
  });

  test('rejects text with MIME application/pdf when content is not PDF', () => {
    const r = validateUploadFile({
      originalname: 'fake.pdf',
      mimetype: 'application/pdf',
      buffer: textBuffer()
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('content is not a PDF');
  });
});

describe('validateUploadFiles (multipart arrays)', () => {
  test('accepts a batch of valid PDF + text files', () => {
    const r = validateUploadFiles([
      { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: pdfBuffer() },
      { originalname: 'b.txt', mimetype: 'text/plain', buffer: textBuffer() }
    ]);
    expect(r.valid).toBe(true);
  });

  test('rejects the batch and reports the offending file name', () => {
    const r = validateUploadFiles([
      { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: pdfBuffer() },
      { originalname: 'payload.bin', mimetype: 'text/plain', buffer: Buffer.from([0x00, 0x01]) }
    ]);
    expect(r.valid).toBe(false);
    expect(r.file).toBe('payload.bin');
  });
});

describe('INGEST-04 checkPdfStructure (header + trailer + polyglot + encryption)', () => {
  const completePdf = Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
    Buffer.from('   \n')
  ]);

  test('accepts a PDF with a valid %%EOF trailer (trailing whitespace ok)', () => {
    expect(checkPdfStructure(completePdf)).toEqual([]);
  });

  test('flags a PDF with no %%EOF trailer', () => {
    const truncated = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
    expect(checkPdfStructure(truncated).join(' ')).toContain('missing');
  });

  test('flags a polyglot PDF with executable content spliced after %%EOF', () => {
    const polyglot = Buffer.concat([
      completePdf,
      Buffer.from('MZ\x90\x00executable-payload-here')
    ]);
    expect(checkPdfStructure(polyglot).join(' ')).toContain('polyglot');
  });

  test('flags an encrypted PDF that declares /Encrypt in its trailer', () => {
    const encrypted = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<< /Encrypt 9 0 R >>\n%%EOF'
    );
    expect(checkPdfStructure(encrypted).join(' ')).toContain('encrypted');
  });
});

describe('INGEST-04 printableTextRatio (text content heuristics)', () => {
  test('accepts legible ASCII text', () => {
    expect(printableTextRatio(textBuffer())).toBeGreaterThan(0.9);
  });

  test('accepts multi-byte UTF-8 (french accents)', () => {
    const utf8 = Buffer.from('Introduction au calcul différentiel.\nÉquations dérivées.', 'utf8');
    expect(printableTextRatio(utf8)).toBeGreaterThan(0.9);
  });

  test('flags binary payloads masked behind a text-like head', () => {
    const masked = Buffer.concat([Buffer.from('hello world\n'), Buffer.from([0x00, 0xff, 0xfe, 0x01, 0xff])]);
    expect(printableTextRatio(masked)).toBeLessThan(0.9);
  });
});

describe('INGEST-04 validateUploadFile (structural/content rejection)', () => {
  test('rejects a truncated PDF (no trailer) with 422-class errors', () => {
    const r = validateUploadFile({
      originalname: 'cut.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('trailer');
  });

  test('rejects a polyglot PDF via validateUploadFile', () => {
    const polyglot = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF'),
      Buffer.from('MZ\x90\x00')
    ]);
    const r = validateUploadFile({
      originalname: 'sneaky.pdf',
      mimetype: 'application/pdf',
      buffer: polyglot
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('polyglot');
  });

  test('rejects an encrypted PDF with a clear message', () => {
    const encrypted = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<< /Encrypt 9 0 R >>\n%%EOF'
    );
    const r = validateUploadFile({
      originalname: 'locked.pdf',
      mimetype: 'application/pdf',
      buffer: encrypted
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('encrypted');
  });

  test('rejects a masked-binary text file via validateUploadFile', () => {
    const masked = Buffer.concat([Buffer.from('hello\n'), Buffer.alloc(40, 0xff)]);
    const r = validateUploadFile({
      originalname: 'masked.txt',
      mimetype: 'text/plain',
      buffer: masked
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('not readable text');
  });

  test('accepts a complete PDF + french text batch', () => {
    const r = validateUploadFiles([
      {
        originalname: 'ok.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.concat([
          Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF'),
          Buffer.from('\n')
        ])
      },
      { originalname: 'cours.txt', mimetype: 'text/plain', buffer: textBuffer() }
    ]);
    expect(r.valid).toBe(true);
  });
});
