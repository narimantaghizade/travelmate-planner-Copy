import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { TravelRepository } from './travelRepository';

const auth = { getUser: vi.fn().mockResolvedValue({ data:{ user:{ id:'verified-user' } }, error:null }) };
const tripRow = { id:'trip-id', owner_id:'verified-user', client_id:null, name:'New name', city:'Kraków', start_date:'2026-08-01', end_date:'2026-08-04', description:'Updated', created_at:'', updated_at:'' };
const destinationRow = { id:'destination-id', trip_id:'trip-id', client_id:null, name:'Updated place', category:'Restaurant', address:'New address', planned_date:'2026-08-02', planned_time:'14:30:00', duration_minutes:90, notes:'Reserve ahead', priority:'Must visit', latitude:50.06, longitude:19.94, estimated_cost:22, visited:false, sort_order:3, created_at:'', updated_at:'' };
const client = (from: ReturnType<typeof vi.fn>) => ({ auth, from }) as unknown as SupabaseClient<Database>;

describe('Stage 2 repository persistence', () => {
  it('persists trip edits and returns the confirmed row', async () => {
    const single = vi.fn().mockResolvedValue({ data:tripRow, error:null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const repo = new TravelRepository(client(vi.fn(() => ({ update }))));

    await expect(repo.updateTrip('trip-id', { name:' New name ', city:'Kraków', start:'2026-08-01', end:'2026-08-04', description:'Updated' }))
      .resolves.toMatchObject({ name:'New name', start:'2026-08-01', end:'2026-08-04' });
    expect(update).toHaveBeenCalledWith({ name:'New name', city:'Kraków', start_date:'2026-08-01', end_date:'2026-08-04', description:'Updated' });
    expect(eq).toHaveBeenCalledWith('id', 'trip-id');
  });

  it('persists destination date, time, details, cost and ordering for reloads', async () => {
    const single = vi.fn().mockResolvedValue({ data:destinationRow, error:null });
    const select = vi.fn(() => ({ single }));
    const eqId = vi.fn(() => ({ select }));
    const eqTrip = vi.fn(() => ({ eq:eqId }));
    const update = vi.fn(() => ({ eq:eqTrip }));
    const repo = new TravelRepository(client(vi.fn(() => ({ update }))));

    const updated = await repo.updateDestination('trip-id', 'destination-id', {
      name:'Updated place', category:'Restaurant', address:'New address', date:'2026-08-02', time:'14:30', duration:90,
      notes:'Reserve ahead', priority:'Must visit', lat:50.06, lng:19.94, price:22, sortOrder:3,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ planned_date:'2026-08-02', planned_time:'14:30', sort_order:3, estimated_cost:22 }));
    expect(eqTrip).toHaveBeenCalledWith('trip_id', 'trip-id');
    expect(eqId).toHaveBeenCalledWith('id', 'destination-id');
    expect(updated).toMatchObject({ date:'2026-08-02', time:'14:30', sortOrder:3, price:22 });
  });

  it('keeps trip data unchanged when deletion is denied', async () => {
    const single = vi.fn().mockResolvedValue({ data:null, error:{ code:'42501', message:'permission denied by row-level security policy' } });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const remove = vi.fn(() => ({ eq }));
    const repo = new TravelRepository(client(vi.fn(() => ({ delete:remove }))));

    await expect(repo.deleteTrip('trip-id')).rejects.toThrow('Delete trip: permission denied by row-level security policy');
    expect(eq).toHaveBeenCalledWith('id', 'trip-id');
  });

  it('persists destination order in scoped updates and reports partial failures', async () => {
    const single = vi.fn().mockResolvedValue({ data:{ id:'updated' }, error:null });
    const select = vi.fn(() => ({ single }));
    const eqId = vi.fn(() => ({ select }));
    const eq = vi.fn(() => ({ eq:eqId }));
    const update = vi.fn(() => ({ eq }));
    const repo = new TravelRepository(client(vi.fn(() => ({ update }))));
    await repo.reorderDestinations('trip-id', ['first', 'second']);
    expect(update).toHaveBeenNthCalledWith(1, { sort_order:0 });
    expect(update).toHaveBeenNthCalledWith(2, { sort_order:1 });
    expect(eq).toHaveBeenNthCalledWith(1, 'trip_id', 'trip-id');
    expect(eq).toHaveBeenNthCalledWith(2, 'trip_id', 'trip-id');
    expect(eqId).toHaveBeenNthCalledWith(1, 'id', 'first');
    expect(eqId).toHaveBeenNthCalledWith(2, 'id', 'second');

    const denied = new TravelRepository(client(vi.fn(() => ({ update:() => ({ eq:() => ({ eq:() => ({ select:() => ({ single:() => Promise.resolve({ data:null, error:{ message:'update denied' } }) }) }) }) }) }))));
    await expect(denied.reorderDestinations('trip-id', ['first'])).rejects.toThrow('Reorder destinations: update denied');
  });

  it('surfaces loading failures rather than replacing cloud data with local demo values', async () => {
    const from = vi.fn((table: string) => table === 'trips'
      ? { select:() => ({ order:() => Promise.resolve({ data:[tripRow], error:null }) }) }
      : table === 'destinations'
        ? { select:() => ({ in:() => ({ order:() => Promise.resolve({ data:null, error:{ message:'destination read denied' } }) }) }) }
        : { select:() => ({ in:() => ({ order:() => Promise.resolve({ data:[], error:null }) }) }) });
    const repo = new TravelRepository(client(from));
    await expect(repo.listTrips()).rejects.toThrow('Load destinations: destination read denied');
  });
});
