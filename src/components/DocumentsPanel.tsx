import { useEffect, useRef, useState } from 'react';
import { Download, FileText, RefreshCw, Trash2, Upload } from 'lucide-react';
import { supabase } from '../supabase';
import { TravelDataError, TravelRepository } from '../data/travelRepository';
import { formatFileSize, MAX_DOCUMENT_BYTES, validateDocumentFile } from '../data/documents';
import type { TravelDocument } from '../types';

type Props = { tripId: string; authenticated: boolean; onNotice: (message: string) => void };

function errorMessage(error: unknown): string {
  return error instanceof TravelDataError || error instanceof Error ? error.message : 'The document request failed.';
}

export default function DocumentsPanel({ tripId, authenticated, onNotice }: Props) {
  const [documents, setDocuments] = useState<TravelDocument[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyDocumentId, setBusyDocumentId] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadAttemptId, setUploadAttemptId] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const [fileValidationError, setFileValidationError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setDocuments([]);
    setCanEdit(false);
    setLoadError('');
    setActionError('');
    if (!supabase) {
      setLoading(false);
      setLoadError('Private documents require a configured Supabase connection.');
      return () => { active = false; };
    }
    if (!authenticated) {
      setLoading(false);
      setLoadError('Sign in to view this trip’s private documents.');
      return () => { active = false; };
    }

    setLoading(true);
    const repository = new TravelRepository(supabase);
    Promise.allSettled([repository.listDocuments(tripId), repository.canEditTrip(tripId)]).then(([documentResult, permissionResult]) => {
      if (!active) return;
      if (documentResult.status === 'rejected') {
        setLoadError(errorMessage(documentResult.reason));
        return;
      }
      setDocuments(documentResult.value);
      if (permissionResult.status === 'fulfilled') {
        setCanEdit(permissionResult.value);
      } else {
        setActionError(`Could not verify editor access. Upload and delete are disabled. ${errorMessage(permissionResult.reason)}`);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [tripId, authenticated, reloadVersion]);

  function chooseFile(file: File | undefined) {
    setActionError('');
    setFileValidationError('');
    setPendingFile(null);
    setUploadAttemptId('');
    if (!file) return;
    try {
      validateDocumentFile(file);
      setPendingFile(file);
      setUploadAttemptId(globalThis.crypto.randomUUID());
    } catch (error) {
      setFileValidationError(errorMessage(error));
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function uploadSelectedFile() {
    if (!supabase || !authenticated || !canEdit || !pendingFile || !uploadAttemptId || busyDocumentId) return;
    setBusyDocumentId('upload');
    setActionError('');
    try {
      const saved = await new TravelRepository(supabase).uploadDocument(tripId, pendingFile, uploadAttemptId);
      setDocuments(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setPendingFile(null);
      setUploadAttemptId('');
      setInputVersion(value => value + 1);
      onNotice('Document uploaded privately to this trip.');
    } catch (error) {
      setActionError(`${errorMessage(error)} If the result was uncertain, retry with the same selected file so TravelMate can reconcile the upload.`);
    } finally {
      setBusyDocumentId('');
    }
  }

  async function downloadDocument(document: TravelDocument) {
    if (!supabase || busyDocumentId) return;
    setBusyDocumentId(document.id);
    setActionError('');
    try {
      const result = await new TravelRepository(supabase).downloadDocument(tripId, document.id);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = result.fileName;
      anchor.style.display = 'none';
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyDocumentId('');
    }
  }

  async function deleteDocument(document: TravelDocument) {
    if (!supabase || !canEdit || busyDocumentId) return;
    if (!window.confirm(`Delete “${document.fileName}” from this trip?`)) return;
    setBusyDocumentId(document.id);
    setActionError('');
    try {
      await new TravelRepository(supabase).deleteDocument(tripId, document.id);
      setDocuments(current => current.filter(item => item.id !== document.id));
      onNotice('Document deleted.');
    } catch (error) {
      // Keep the row visible after partial failure so the user can retry cleanup.
      setActionError(errorMessage(error));
    } finally {
      setBusyDocumentId('');
    }
  }

  return <section className="documents-workspace">
    <div className="section-title-row">
      <div><h3>Private trip documents</h3><p>Files are stored privately and shared only with authorized trip members.</p></div>
      <button className="secondary-btn" onClick={() => setReloadVersion(value => value + 1)} disabled={loading || Boolean(busyDocumentId)}><RefreshCw size={15}/> Refresh</button>
    </div>

    {canEdit && <section className="panel document-upload-panel">
      <div className="document-upload-copy"><div className="placeholder-illustration"><Upload size={23}/></div><div><b>Add a travel document</b><p>PDF, JPEG, PNG, or WebP · {MAX_DOCUMENT_BYTES / (1024 * 1024)} MiB maximum</p></div></div>
      <div className="document-upload-controls">
        <input
          key={inputVersion}
          ref={fileInput}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={event => chooseFile(event.currentTarget.files?.[0])}
          aria-label="Choose a travel document"
        />
        <button className="primary-btn" onClick={() => void uploadSelectedFile()} disabled={!pendingFile || Boolean(busyDocumentId)}>
          <Upload size={15}/>{busyDocumentId === 'upload' ? 'Uploading…' : 'Upload privately'}
        </button>
      </div>
      {pendingFile && <p className="document-selection">Selected: {pendingFile.name} · {formatFileSize(pendingFile.size)}</p>}
      {fileValidationError && <div className="form-warning document-message" role="alert">{fileValidationError}</div>}
    </section>}
    {authenticated && !canEdit && !actionError && <p className="document-readonly-note">You can view and download documents. Only trip editors can upload or delete them.</p>}
    {loadError && <div className="form-warning document-message" role="alert">{loadError}</div>}
    {actionError && <div className="form-warning document-message" role="alert">{actionError}</div>}
    {loading && <div className="panel document-empty" role="status">Loading this trip’s documents…</div>}
    {!loading && !loadError && documents.length === 0 && <div className="panel document-empty"><FileText size={25}/><b>No documents yet</b><span>Upload tickets, confirmations, or other files for this trip.</span></div>}
    {!loading && documents.length > 0 && <div className="document-list">{documents.map(document => <article className="panel document-row" key={document.id}>
      <div className="document-file-icon"><FileText size={20}/></div>
      <div className="document-file-info"><b>{document.fileName}</b><span>{document.mimeType} · {formatFileSize(document.sizeBytes)} · {new Date(document.createdAt).toLocaleDateString()}</span></div>
      <div className="document-actions">
        <button className="secondary-btn" onClick={() => void downloadDocument(document)} disabled={Boolean(busyDocumentId)}><Download size={15}/>{busyDocumentId === document.id ? 'Working…' : 'Download'}</button>
        {canEdit && <button className="icon-btn" onClick={() => void deleteDocument(document)} disabled={Boolean(busyDocumentId)} aria-label={`Delete ${document.fileName}`} title="Delete document"><Trash2 size={15}/></button>}
      </div>
    </article>)}</div>}
  </section>;
}
