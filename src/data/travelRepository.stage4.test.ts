import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import type { TravelDocument } from '../types';
import { TravelDataError, TravelRepository } from './travelRepository';

const row = {
  id:'doc-1', trip_id:'trip-1', booking_id:null, uploaded_by:'user-1', storage_path:'trip-1/doc-1/ticket.pdf',
  file_name:'ticket.pdf', mime_type:'application/pdf', size_bytes:12, created_at:'2026-10-01T10:00:00Z',
};
const mappedDocument: TravelDocument = {
  id:'doc-1', tripId:'trip-1', bookingId:null, uploadedBy:'user-1', storagePath:row.storage_path,
  fileName:'ticket.pdf', mimeType:'application/pdf', sizeBytes:12, createdAt:row.created_at,
};
const file = Object.assign(new Blob(['test'], { type:'application/pdf' }), { name:'ticket.pdf' }) as File;

function client(from: ReturnType<typeof vi.fn>, storage: { from: ReturnType<typeof vi.fn> }, rpc = vi.fn().mockResolvedValue({ data:true, error:null })) {
  return {
    auth:{ getUser:vi.fn().mockResolvedValue({ data:{ user:{ id:'user-1' } }, error:null }) },
    from, storage, rpc,
  } as unknown as SupabaseClient<Database>;
}

describe('Stage 4 document repository', () => {
  it('lists trip-scoped metadata and checks editor access using the authenticated client', async () => {
    const order = vi.fn().mockResolvedValue({ data:[row], error:null });
    const eq = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select:vi.fn(() => ({ eq })) }));
    const rpc = vi.fn().mockResolvedValue({ data:true, error:null });
    const repo = new TravelRepository(client(from, { from:vi.fn() }, rpc));
    await expect(repo.listDocuments('trip-1')).resolves.toEqual([mappedDocument]);
    await expect(repo.canEditTrip('trip-1')).resolves.toBe(true);
    expect(eq).toHaveBeenCalledWith('trip_id', 'trip-1');
    expect(rpc).toHaveBeenCalledWith('can_edit_trip', { target_trip:'trip-1' });
  });

  it('uploads without overwrite and writes metadata with the verified auth user', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data:null, error:null });
    const insertSingle = vi.fn().mockResolvedValue({ data:row, error:null });
    const from = vi.fn(() => ({
      select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }),
      insert:vi.fn(() => ({ select:() => ({ single:insertSingle }) })),
    }));
    const upload = vi.fn().mockResolvedValue({ data:{ path:row.storage_path }, error:null });
    const download = vi.fn();
    const remove = vi.fn();
    const storageFrom = vi.fn(() => ({ upload, download, remove }));
    const repo = new TravelRepository(client(from, { from:storageFrom }));

    await expect(repo.uploadDocument('trip-1', file, 'doc-1')).resolves.toEqual(mappedDocument);
    expect(upload).toHaveBeenCalledWith(row.storage_path, file, { contentType:'application/pdf', upsert:false });
    expect(insertSingle).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith('documents');
  });

  it('removes the uploaded object when metadata insertion fails and reports failed cleanup', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data:null, error:null });
    const insertSingle = vi.fn().mockResolvedValue({ data:null, error:{ message:'metadata rejected' } });
    const from = vi.fn(() => ({
      select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }),
      insert:() => ({ select:() => ({ single:insertSingle }) }),
    }));
    const upload = vi.fn().mockResolvedValue({ data:{ path:row.storage_path }, error:null });
    const remove = vi.fn().mockResolvedValue({ data:[{ name:row.storage_path }], error:null });
    const repo = new TravelRepository(client(from, { from:vi.fn(() => ({ upload, remove, download:vi.fn() })) }));
    await expect(repo.uploadDocument('trip-1', file, 'doc-1')).rejects.toThrow('Save document metadata: metadata rejected');
    expect(remove).toHaveBeenCalledWith([row.storage_path]);

    const failedCleanup = vi.fn().mockResolvedValue({ data:null, error:{ message:'storage denied' } });
    const retryFrom = vi.fn(() => ({
      select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }),
      insert:() => ({ select:() => ({ single:insertSingle }) }),
    }));
    const retryRepo = new TravelRepository(client(retryFrom, { from:vi.fn(() => ({ upload, remove:failedCleanup, download:vi.fn() })) }));
    await expect(retryRepo.uploadDocument('trip-1', file, 'doc-1')).rejects.toThrow('could not be cleaned up');
  });

  it('downloads only through Storage and leaves metadata visible if object removal succeeds but metadata deletion fails', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data:row, error:null });
    const metadataDelete = vi.fn().mockResolvedValue({ error:{ message:'metadata RLS denied' } });
    const eqSecond = vi.fn(() => metadataDelete());
    const eqFirst = vi.fn(() => ({ eq:eqSecond }));
    const from = vi.fn(() => ({
      select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }),
      delete:() => ({ eq:eqFirst }),
    }));
    const blob = new Blob(['private document']);
    const download = vi.fn().mockResolvedValue({ data:blob, error:null });
    const remove = vi.fn().mockResolvedValue({ data:[{ name:row.storage_path }], error:null });
    const repo = new TravelRepository(client(from, { from:vi.fn(() => ({ download, remove })) }));
    await expect(repo.downloadDocument('trip-1', 'trip-1/doc-1')).resolves.toEqual({ blob, fileName:'ticket.pdf' });
    await expect(repo.deleteDocument('trip-1', 'doc-1')).rejects.toThrow('file was removed, but its metadata could not be deleted');
    expect(download).toHaveBeenCalledWith(row.storage_path);
    expect(remove).toHaveBeenCalledWith([row.storage_path]);
    expect(metadataDelete).toHaveBeenCalledOnce();
  });

  it('rejects document access without a verified session', async () => {
    const supabase = client(vi.fn(), { from:vi.fn() });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data:{ user:null }, error:null } as never);
    await expect(new TravelRepository(supabase).listDocuments('trip-1')).rejects.toBeInstanceOf(TravelDataError);
  });
});
