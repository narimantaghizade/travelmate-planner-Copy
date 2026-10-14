import { describe, expect, it } from 'vitest';
import { buildDocumentObjectPath, MAX_DOCUMENT_BYTES, validateDocumentFile } from './documents';

describe('travel document validation and paths', () => {
  it('accepts only allowed MIME types and files at or below 25 MiB', () => {
    expect(() => validateDocumentFile({ name:'ticket.pdf', type:'application/pdf', size:MAX_DOCUMENT_BYTES })).not.toThrow();
    expect(() => validateDocumentFile({ name:'photo.webp', type:'image/webp', size:1 })).not.toThrow();
    expect(() => validateDocumentFile({ name:'script.svg', type:'image/svg+xml', size:100 })).toThrow('PDF, JPEG, PNG, or WebP');
    expect(() => validateDocumentFile({ name:'large.pdf', type:'application/pdf', size:MAX_DOCUMENT_BYTES + 1 })).toThrow('25 MiB');
    expect(() => validateDocumentFile({ name:'empty.pdf', type:'application/pdf', size:0 })).toThrow('empty');
  });

  it('places the trip UUID first and prevents filenames from adding path segments', () => {
    expect(buildDocumentObjectPath('trip-uuid', 'document-uuid', '../my\\ticket.pdf'))
      .toBe('trip-uuid/document-uuid/_my_ticket.pdf');
  });
});
