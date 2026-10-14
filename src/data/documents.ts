import type { TravelDocument } from '../types';
import type { Database } from '../database.types';

export const DOCUMENT_BUCKET = 'trip-documents';
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type DocumentFile = Pick<File, 'name' | 'size' | 'type'>;

export function validateDocumentFile(file: DocumentFile): void {
  if (!DOCUMENT_MIME_TYPES.includes(file.type as typeof DOCUMENT_MIME_TYPES[number])) {
    throw new Error('Choose a PDF, JPEG, PNG, or WebP file.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('The selected file is empty or has an invalid size.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Files must be 25 MiB or smaller.');
  if (!file.name.trim()) throw new Error('The selected file must have a filename.');
}

export function buildDocumentObjectPath(tripId: string, documentId: string, fileName: string): string {
  const safeName = fileName.normalize('NFKC')
    .replace(/[\\/]/g, '_')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return `${tripId}/${documentId}/${safeName || 'document'}`;
}

export function documentFromRow(row: DocumentRow): TravelDocument {
  return {
    id: row.id,
    tripId: row.trip_id,
    bookingId: row.booking_id,
    uploadedBy: row.uploaded_by,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  };
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
