import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { isBrowserSafeSupabaseKey } from '../supabase';
import {
  bookingFromRow,
  bookingToRow,
  destinationFromRow,
  destinationToRow,
  requireAuthenticatedUser,
  throwIfError,
  tripFromRow,
  tripToRow,
  TravelDataError,
  TravelRepository,
} from './travelRepository';

describe('database conversion', () => {
  it('round-trips nullable trip dates and leaves the owner id to the verified session', () => {
    const row = {
      id: 'trip-uuid', owner_id: 'auth-uuid', client_id: 'local-trip', name: 'Weekend', city: 'Gdańsk',
      start_date: null, end_date: null, description: '', created_at: '', updated_at: '',
    };
    expect(tripFromRow(row)).toMatchObject({ id: 'trip-uuid', start: '', end: '', destinations: [] });
    expect(tripToRow({ name: ' Weekend ', city: 'Gdańsk', start: '', end: '', description: '', clientId: 'local-trip' }, 'verified-user')).toEqual({
      owner_id: 'verified-user', client_id: 'local-trip', name: 'Weekend', city: 'Gdańsk', start_date: null, end_date: null, description: '',
    });
  });

  it('maps destination fields, null dates and missing coordinates consistently', () => {
    const row = {
      id: 'destination-uuid', trip_id: 'trip-uuid', client_id: null, name: 'Museum', category: 'Attraction', address: '',
      planned_date: null, planned_time: null, duration_minutes: 60, notes: '', priority: 'Optional', latitude: null,
      longitude: null, estimated_cost: 12.5, visited: false, sort_order: 0, created_at: '', updated_at: '',
    };
    expect(destinationFromRow(row)).toMatchObject({ date: '', time: '', lat: 48.8566, lng: 2.3522, price: 12.5 });
    expect(destinationToRow({ name: 'Museum', category: 'Attraction', address: '', date: '', time: '', duration: 60, notes: '', priority: 'Optional', lat: 1, lng: 2, price: 5 }, 'trip-uuid')).toMatchObject({
      trip_id: 'trip-uuid', planned_date: null, planned_time: null, latitude: 1, longitude: 2, estimated_cost: 5,
    });
  });

  it('keeps trip identity in the booking UI id and converts empty values to SQL null', () => {
    const row = {
      id: 'booking-uuid', trip_id: 'trip-uuid', client_id: null, kind: 'Flight' as const, title: 'Flight', booking_date: null,
      local_time: null, reference: '', address: '', estimated_cost: 0, currency: 'EUR', notes: '', provider: '', booking_url: '', status: 'planned' as const, created_at: '', updated_at: '',
    };
    expect(bookingFromRow(row).id).toBe('trip-uuid/booking-uuid');
    expect(bookingToRow({ kind: 'Flight', title: ' Flight ', date: '', time: '', reference: '', address: '', price: 0, currency:'EUR', notes: '', provider:'', bookingUrl:'', status:'planned' }, 'trip-uuid')).toMatchObject({
      title: 'Flight', booking_date: null, local_time: null, trip_id: 'trip-uuid', currency: 'EUR', provider:'', booking_url:'', status:'planned',
    });
  });
});

describe('database access behavior', () => {
  it('uses the verified Supabase user id as owner_id during trip creation', async () => {
    const diagnostic = vi.spyOn(console, 'info').mockImplementation(() => {});
    const savedTrip = {
      id: 'trip-row-id', owner_id: 'verified-auth-user', client_id: 'client-trip-id', name: 'Cloud trip', city: 'Warsaw',
      start_date: null, end_date: null, description: '', created_at: '', updated_at: '',
    };
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: savedTrip, error: null });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const insert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'verified-auth-user' } } }, error: null }),
      },
      from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient<Database>;

    const repo = new TravelRepository(client);
    await repo.createTrip({ name: 'Cloud trip', city: 'Warsaw', start: '', end: '', description: '', clientId: 'client-trip-id' });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'verified-auth-user', client_id: 'client-trip-id' }));
    expect(select).toHaveBeenCalledWith('*');
    expect(eqOwnerId).toHaveBeenCalledWith('owner_id', 'verified-auth-user');
    expect(eqClientId).toHaveBeenCalledWith('client_id', 'client-trip-id');
    expect(eqOwnerId).toHaveBeenCalledTimes(2);
    expect(eqClientId).toHaveBeenCalledTimes(2);
    expect((client.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith('[TravelMate trip insert diagnostic]', {
      authenticatedUserId: 'verified-auth-user',
      payloadOwnerId: 'verified-auth-user',
      ownerIdMatches: true,
    });
    expect(diagnostic).toHaveBeenCalledWith('[TravelMate Auth session diagnostic]', {
      sessionPresent: true,
      sessionMatchesGetUser: true,
      sessionReadError: false,
    });
    expect(client.auth.getSession).toHaveBeenCalledOnce();
    diagnostic.mockRestore();
  });

  it('rejects Supabase secret and service-role keys from browser configuration', () => {
    const servicePayload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=/g, '');
    expect(isBrowserSafeSupabaseKey('sb_secret_example')).toBe(false);
    expect(isBrowserSafeSupabaseKey(`header.${servicePayload}.signature`)).toBe(false);
    expect(isBrowserSafeSupabaseKey('sb_publishable_example')).toBe(true);
  });

  it('rejects cloud access when Supabase Auth has no verified user', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    const client = { auth: { getUser } } as unknown as SupabaseClient<Database>;
    await expect(requireAuthenticatedUser(client)).rejects.toThrow('Sign in to Supabase');
    expect(getUser).toHaveBeenCalledOnce();
  });

  it('shows the actual database RLS error when a verified user trip insert is rejected', async () => {
    const failureDiagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authDiagnostics = vi.spyOn(console, 'info').mockImplementation(() => {});
    const databaseMessage = 'new row violates row-level security policy for table "trips"';
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501', message: databaseMessage } });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'verified-auth-user' } } }, error: null }),
      },
      from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient<Database>;

    await expect(new TravelRepository(client).createTrip({ name: 'Trip', city: 'Warsaw', start: '', end: '', description: '' }))
      .rejects.toThrow(`Create trip: ${databaseMessage} (42501)`);
    expect(failureDiagnostic).toHaveBeenCalledWith('[TravelMate trip insert failed]', {
      code: '42501',
      message: databaseMessage,
    });
    expect(authDiagnostics).toHaveBeenCalledWith('[TravelMate Auth session diagnostic]', {
      sessionPresent: true,
      sessionMatchesGetUser: true,
      sessionReadError: false,
    });
    expect(client.auth.getSession).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledTimes(2);
    authDiagnostics.mockRestore();
    failureDiagnostic.mockRestore();
  });

  it('reports a follow-up read failure explicitly after the insert succeeds', async () => {
    const authDiagnostics = vi.spyOn(console, 'info').mockImplementation(() => {});
    const insert = vi.fn().mockResolvedValue({ error: null });
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'membership row is not visible' } });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'verified-auth-user' } } }, error: null }),
      },
      from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient<Database>;

    await expect(new TravelRepository(client).createTrip({
      name: 'Trip', city: 'Warsaw', start: '', end: '', description: '', clientId: 'client-trip-id',
    })).rejects.toThrow('Trip was inserted, but loading it failed. Retry the same trip submission to recover it safely. (Find trip by client ID: membership row is not visible)');
    expect(insert).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledTimes(2);
    authDiagnostics.mockRestore();
  });

  it('reconciles an uncertain insert by the verified owner and same client id', async () => {
    const authDiagnostics = vi.spyOn(console, 'info').mockImplementation(() => {});
    const savedTrip = {
      id: 'trip-row-id', owner_id: 'verified-auth-user', client_id: 'stable-client-id', name: 'Trip', city: 'Warsaw',
      start_date: null, end_date: null, description: '', created_at: '', updated_at: '',
    };
    const insert = vi.fn().mockRejectedValue(new TypeError('Network connection lost'));
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: savedTrip, error: null });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'verified-auth-user' } } }, error: null }),
      },
      from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient<Database>;

    await expect(new TravelRepository(client).createTrip({
      name: 'Trip', city: 'Warsaw', start: '', end: '', description: '', clientId: 'stable-client-id',
    })).resolves.toMatchObject({ id: 'trip-row-id', name: 'Trip' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'verified-auth-user', client_id: 'stable-client-id' }));
    expect(eqOwnerId).toHaveBeenCalledWith('owner_id', 'verified-auth-user');
    expect(eqClientId).toHaveBeenCalledWith('client_id', 'stable-client-id');
    authDiagnostics.mockRestore();
  });

  it('recovers a prior successful insert on retry without creating a duplicate', async () => {
    const authDiagnostics = vi.spyOn(console, 'info').mockImplementation(() => {});
    const savedTrip = {
      id: 'trip-row-id', owner_id: 'verified-auth-user', client_id: 'stable-client-id', name: 'Trip', city: 'Warsaw',
      start_date: null, end_date: null, description: '', created_at: '', updated_at: '',
    };
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: null });
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'temporary read failure' } })
      .mockResolvedValueOnce({ data: savedTrip, error: null });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'verified-auth-user' } } }, error: null }),
      },
      from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient<Database>;
    const repository = new TravelRepository(client);
    const attemptedTrip = { name: 'Trip', city: 'Warsaw', start: '', end: '', description: '', clientId: 'stable-client-id' };

    await expect(repository.createTrip(attemptedTrip)).rejects.toThrow('Retry the same trip submission to recover it safely.');
    await expect(repository.createTrip(attemptedTrip)).resolves.toMatchObject({ id: 'trip-row-id' });
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'stable-client-id' }));
    expect(maybeSingle).toHaveBeenCalledTimes(3);
    authDiagnostics.mockRestore();
  });

  it('uses the unique owner/client constraint to reconcile a concurrent duplicate attempt', async () => {
    const authDiagnostics = vi.spyOn(console, 'info').mockImplementation(() => {});
    const failureDiagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const savedTrip = {
      id: 'trip-row-id', owner_id: 'verified-auth-user', client_id: 'stable-client-id', name: 'Trip', city: 'Warsaw',
      start_date: null, end_date: null, description: '', created_at: '', updated_at: '',
    };
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate owner/client id' } });
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: savedTrip, error: null });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'verified-auth-user' } } }, error: null }),
      },
      from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient<Database>;

    await expect(new TravelRepository(client).createTrip({
      name: 'Trip', city: 'Warsaw', start: '', end: '', description: '', clientId: 'stable-client-id',
    })).resolves.toMatchObject({ id: 'trip-row-id' });
    expect(insert).toHaveBeenCalledOnce();
    expect(eqOwnerId).toHaveBeenLastCalledWith('owner_id', 'verified-auth-user');
    expect(eqClientId).toHaveBeenLastCalledWith('client_id', 'stable-client-id');
    authDiagnostics.mockRestore();
    failureDiagnostic.mockRestore();
  });

  it('imports trips without returning rows and fetches by verified owner and stable local id', async () => {
    const savedTrip = {
      id: 'trip-row-id', owner_id: 'verified-auth-user', client_id: 'local-trip-id', name: 'Local trip', city: 'Gdańsk',
      start_date: null, end_date: null, description: '', created_at: '', updated_at: '',
    };
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: savedTrip, error: null });
    const eqClientId = vi.fn(() => ({ maybeSingle }));
    const eqOwnerId = vi.fn(() => ({ eq: eqClientId }));
    const select = vi.fn(() => ({ eq: eqOwnerId }));
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-auth-user' } }, error: null }) },
      from: vi.fn(() => ({ upsert, select })),
    } as unknown as SupabaseClient<Database>;
    const workspace = {
      trips: [{ id: 'local-trip-id', name: 'Local trip', city: 'Gdańsk', start: '', end: '', description: '', destinations: [] }],
      bookings: [],
    };

    await expect(new TravelRepository(client).importLocalWorkspace(workspace)).resolves.toEqual({ trips: 1, destinations: 0, bookings: 0 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'verified-auth-user', client_id: 'local-trip-id' }), {
      onConflict: 'owner_id,client_id', ignoreDuplicates: true,
    });
    expect(select).toHaveBeenCalledWith('*');
    expect(eqOwnerId).toHaveBeenCalledWith('owner_id', 'verified-auth-user');
    expect(eqClientId).toHaveBeenCalledWith('client_id', 'local-trip-id');
  });

  it('preserves Supabase operation and server error details', () => {
    expect(() => throwIfError({ message: 'row-level security denied the insert' }, 'Create trip')).toThrow(TravelDataError);
    expect(() => throwIfError({ message: 'row-level security denied the insert' }, 'Create trip')).toThrow('Create trip: row-level security denied the insert');
    expect(() => throwIfError(null, 'Create trip')).not.toThrow();
  });
});
