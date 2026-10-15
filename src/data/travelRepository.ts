import type { SupabaseClient } from '@supabase/supabase-js';
import { expectTripInsertSessionUser } from '../supabase';
import type { Database } from '../database.types';
import type { Booking, BookingDraft, Destination, DestinationDraft, Expense, ExpenseDraft, TravelDocument, Trip, TripDraft } from '../types';
import { buildDocumentObjectPath, documentFromRow, DOCUMENT_BUCKET, validateDocumentFile } from './documents';

type Client = SupabaseClient<Database>;
type TripRow = Database['public']['Tables']['trips']['Row'];
type DestinationRow = Database['public']['Tables']['destinations']['Row'];
type BookingRow = Database['public']['Tables']['bookings']['Row'];
type ExpenseRow = Database['public']['Tables']['expenses']['Row'];
type FlightRow = Database['public']['Tables']['flights']['Row'];
type AccommodationRow = Database['public']['Tables']['accommodations']['Row'];
type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type LocalWorkspace = { trips: Trip[]; bookings: Booking[] };
export type TripWorkspace = { trips: Trip[]; bookings: Booking[]; expenses: Expense[] };

export class TravelDataError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TravelDataError';
  }
}

export function throwIfError(error: { message: string } | null, operation: string): void {
  if (error) throw new TravelDataError(`${operation}: ${error.message}`, error);
}

function requireData<T>(data: T | null, error: { message: string } | null, operation: string): T {
  throwIfError(error, operation);
  if (data === null) throw new TravelDataError(`${operation}: Supabase returned no row.`);
  return data;
}

export async function requireAuthenticatedUser(client: Client): Promise<{ id: string }> {
  const { data, error } = await client.auth.getUser();
  if (error) throw new TravelDataError(`Unable to verify your Supabase session. Sign in again before accessing cloud trips. (${error.message})`, error);
  if (!data.user) throw new TravelDataError('Sign in to Supabase before accessing cloud trips.');
  return { id: data.user.id };
}

export function tripFromRow(row: TripRow, destinations: Destination[] = []): Trip {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    start: row.start_date ?? '',
    end: row.end_date ?? '',
    description: row.description,
    destinations,
  };
}

export function destinationFromRow(row: DestinationRow): Destination {
  return {
    id: row.id,
    name: row.name,
    category: row.category as Destination['category'],
    address: row.address,
    date: row.planned_date ?? '',
    time: row.planned_time?.slice(0, 5) ?? '',
    duration: row.duration_minutes,
    notes: row.notes,
    priority: row.priority as Destination['priority'],
    lat: row.latitude,
    lng: row.longitude,
    price: Number(row.estimated_cost),
    visited: row.visited,
    sortOrder: row.sort_order,
  };
}

export function bookingFromRow(row: BookingRow): Booking {
  return bookingFromRelatedRows(row);
}

export function bookingFromRelatedRows(row: BookingRow, flight?: FlightRow, accommodation?: AccommodationRow): Booking {
  const departureAt = flight?.departure_at ?? '';
  return {
    id: `${row.trip_id}/${row.id}`,
    kind: row.kind,
    title: row.title,
    date: row.booking_date ?? departureAt.slice(0, 10),
    time: row.local_time?.slice(0, 5) ?? departureAt.slice(11, 16),
    reference: row.reference,
    address: accommodation?.address || row.address,
    price: Number(row.estimated_cost),
    notes: row.notes,
    currency: row.currency.trim(),
    provider: row.provider || flight?.airline || accommodation?.property_name || '',
    bookingUrl: row.booking_url,
    status: row.status,
    ...(flight ? { flight: {
      airline: flight.airline, flightNumber: flight.flight_number, departureAirport: flight.departure_airport,
      arrivalAirport: flight.arrival_airport, departureAt: flight.departure_at ?? '', arrivalAt: flight.arrival_at ?? '',
    } } : {}),
    ...(accommodation ? { accommodation: {
      propertyName: accommodation.property_name, checkInAt: accommodation.check_in_at ?? '',
      checkOutAt: accommodation.check_out_at ?? '', address: accommodation.address,
    } } : {}),
  };
}

export function tripToRow(input: TripDraft, ownerId: string) {
  return {
    owner_id: ownerId,
    client_id: input.clientId ?? null,
    name: input.name.trim(),
    city: input.city,
    start_date: input.start || null,
    end_date: input.end || null,
    description: input.description,
  };
}

function newTripClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function destinationToRow(input: DestinationDraft, tripId: string) {
  return {
    trip_id: tripId,
    client_id: input.clientId ?? null,
    name: input.name.trim(),
    category: input.category,
    address: input.address,
    planned_date: input.date || null,
    planned_time: input.time || null,
    duration_minutes: input.duration,
    notes: input.notes,
    priority: input.priority,
    latitude: input.lat,
    longitude: input.lng,
    estimated_cost: input.price,
    visited: input.visited ?? false,
    sort_order: input.sortOrder ?? 0,
  };
}

export function bookingToRow(input: BookingDraft, tripId: string) {
  validateBookingInput(input);
  return {
    trip_id: tripId,
    client_id: input.clientId ?? null,
    kind: input.kind,
    title: input.title.trim(),
    booking_date: input.date || null,
    local_time: input.time || null,
    reference: input.reference,
    address: input.kind === 'Accommodation' ? '' : input.address.trim(),
    estimated_cost: input.price,
    currency: input.currency.toUpperCase(),
    notes: input.notes.trim(),
    provider: input.kind === 'Flight' || input.kind === 'Accommodation' ? '' : input.provider.trim(),
    booking_url: input.bookingUrl.trim(),
    status: input.status,
  };
}

export function validateBookingInput(input: Pick<BookingDraft, 'kind' | 'title' | 'price' | 'currency' | 'bookingUrl' | 'status'>): void {
  if (!input.title.trim()) throw new TravelDataError('Booking name is required.');
  if (!['Flight', 'Accommodation', 'Ticket', 'Activity', 'Restaurant', 'Transfer', 'Transport', 'Parking', 'Other'].includes(input.kind)) throw new TravelDataError('Choose a valid booking type.');
  if (!Number.isFinite(input.price) || input.price < 0) throw new TravelDataError('Booking amount must be a nonnegative number.');
  if (!/^[A-Za-z]{3}$/.test(input.currency.trim())) throw new TravelDataError('Currency must be a three-letter currency code.');
  if (!['planned', 'confirmed', 'cancelled', 'completed'].includes(input.status)) throw new TravelDataError('Choose a valid booking status.');
  if (input.bookingUrl.trim()) {
    let parsed: URL;
    try { parsed = new URL(input.bookingUrl.trim()); } catch { throw new TravelDataError('Booking URL must be a valid web address.'); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new TravelDataError('Booking URL must use HTTP or HTTPS.');
  }
}

export function expenseFromRow(row: ExpenseRow): Expense {
  return {
    id: `${row.trip_id}/${row.id}`, category: row.category, title: row.title, amount: Number(row.amount),
    currency: row.currency.trim(), date: row.spent_on ?? '', notes: row.notes,
    bookingId: row.booking_id ? `${row.trip_id}/${row.booking_id}` : null,
    destinationId: row.destination_id,
  };
}

export function expenseToRow(input: ExpenseDraft, tripId: string) {
  validateExpenseInput(input);
  return {
    trip_id: tripId,
    booking_id: input.bookingId ? databaseId(input.bookingId) : null,
    destination_id: input.destinationId || null,
    title: input.title.trim(), amount: input.amount, currency: input.currency.trim().toUpperCase(),
    spent_on: input.date || null, notes: input.notes.trim(), category: input.category.trim(),
  };
}

export function validateExpenseInput(input: Pick<ExpenseDraft, 'category' | 'title' | 'amount' | 'currency' | 'date'>): void {
  if (!input.category.trim()) throw new TravelDataError('Expense category is required.');
  if (!input.title.trim()) throw new TravelDataError('Expense description is required.');
  if (!input.date) throw new TravelDataError('Expense date is required.');
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new TravelDataError('Expense amount must be a nonnegative number.');
  if (!/^[A-Za-z]{3}$/.test(input.currency.trim())) throw new TravelDataError('Currency must be a three-letter currency code.');
}

export class TravelRepository {
  constructor(private readonly client: Client) {}

  private async findTripByOwnerAndClientId(ownerId: string, clientId: string): Promise<TripRow | null> {
    const { data, error } = await this.client.from('trips')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('client_id', clientId)
      .maybeSingle();
    throwIfError(error, 'Find trip by client ID');
    return data;
  }

  private async reconcileUncertainTripInsert(ownerId: string, clientId: string, insertCause: unknown): Promise<TripRow> {
    try {
      const existing = await this.findTripByOwnerAndClientId(ownerId, clientId);
      if (existing) return existing;
      throw new TravelDataError('Trip creation could not be confirmed. Retry the same trip submission so TravelMate can safely reuse its client ID.', insertCause);
    } catch (reconciliationError) {
      if (reconciliationError instanceof TravelDataError && reconciliationError.cause === insertCause) throw reconciliationError;
      const detail = reconciliationError instanceof Error ? reconciliationError.message : 'The follow-up lookup failed.';
      throw new TravelDataError(`Trip creation result is uncertain because the insert and reconciliation both failed. Retry the same trip submission to check it safely. (${detail})`, {
        insertCause,
        reconciliationError,
      });
    }
  }

  async listTrips(): Promise<TripWorkspace> {
    await requireAuthenticatedUser(this.client);
    const { data: tripRows, error: tripError } = await this.client.from('trips').select('*').order('created_at');
    throwIfError(tripError, 'Load trips');
    const rows = tripRows ?? [];
    if (rows.length === 0) return { trips: [], bookings: [], expenses: [] };
    const ids = rows.map(row => row.id);
    const [destinationResult, bookingResult, flightResult, accommodationResult, expenseResult] = await Promise.all([
      this.client.from('destinations').select('*').in('trip_id', ids).order('sort_order'),
      this.client.from('bookings').select('*').in('trip_id', ids).order('booking_date'),
      this.client.from('flights').select('*').in('trip_id', ids),
      this.client.from('accommodations').select('*').in('trip_id', ids),
      this.client.from('expenses').select('*').in('trip_id', ids).order('spent_on'),
    ]);
    throwIfError(destinationResult.error, 'Load destinations');
    throwIfError(bookingResult.error, 'Load bookings');
    throwIfError(flightResult.error, 'Load flight details');
    throwIfError(accommodationResult.error, 'Load accommodation details');
    throwIfError(expenseResult.error, 'Load expenses');
    const destinationsByTrip = new Map<string, Destination[]>();
    for (const row of destinationResult.data ?? []) {
      const items = destinationsByTrip.get(row.trip_id) ?? [];
      items.push(destinationFromRow(row));
      destinationsByTrip.set(row.trip_id, items);
    }
    const flightsByBooking = new Map((flightResult.data ?? []).map(item => [item.booking_id, item]));
    const accommodationByBooking = new Map((accommodationResult.data ?? []).map(item => [item.booking_id, item]));
    return {
      trips: rows.map(row => tripFromRow(row, destinationsByTrip.get(row.id) ?? [])),
      bookings: (bookingResult.data ?? []).map(row => bookingFromRelatedRows(row, flightsByBooking.get(row.id), accommodationByBooking.get(row.id))),
      expenses: (expenseResult.data ?? []).map(expenseFromRow),
    };
  }

  async createTrip(input: TripDraft): Promise<Trip> {
    const user = await requireAuthenticatedUser(this.client);
    const clientId = input.clientId ?? newTripClientId();
    const payload = tripToRow({ ...input, clientId }, user.id);
    const priorAttempt = await this.findTripByOwnerAndClientId(user.id, clientId);
    if (priorAttempt) return tripFromRow(priorAttempt);
    if (import.meta.env.DEV) {
      console.info('[TravelMate trip insert diagnostic]', {
        authenticatedUserId: user.id,
        payloadOwnerId: payload.owner_id,
        ownerIdMatches: user.id === payload.owner_id,
      });
      const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
      const sessionUserId = sessionData.session?.user.id ?? null;
      console.info('[TravelMate Auth session diagnostic]', {
        sessionPresent: Boolean(sessionData.session),
        sessionMatchesGetUser: Boolean(sessionUserId && sessionUserId === user.id),
        sessionReadError: Boolean(sessionError),
      });
      expectTripInsertSessionUser(sessionUserId);
    }
    // Keep INSERT and SELECT in separate PostgREST requests. A RETURNING row
    // is subject to the trips SELECT policy before an AFTER INSERT membership
    // trigger can make the owner a visible member.
    let insertError: { code?: string; message: string } | null;
    try {
      ({ error: insertError } = await this.client.from('trips').insert(payload));
    } catch (insertCause) {
      const row = await this.reconcileUncertainTripInsert(user.id, clientId, insertCause);
      return tripFromRow(row);
    }
    if (insertError && import.meta.env.DEV) {
      console.error('[TravelMate trip insert failed]', {
        code: insertError.code ?? null,
        message: insertError.message,
      });
    }
    if (insertError?.code === '42501') {
      throw new TravelDataError(`Create trip: ${insertError.message} (${insertError.code})`, insertError);
    }
    if (insertError?.code === '23505') {
      const existing = await this.findTripByOwnerAndClientId(user.id, clientId);
      if (existing) return tripFromRow(existing);
    }
    throwIfError(insertError, 'Create trip');

    let row: TripRow | null;
    try {
      row = await this.findTripByOwnerAndClientId(user.id, clientId);
    } catch (fetchError) {
      const detail = fetchError instanceof Error ? fetchError.message : 'The follow-up lookup failed.';
      throw new TravelDataError(`Trip was inserted, but loading it failed. Retry the same trip submission to recover it safely. (${detail})`, fetchError);
    }
    if (!row) throw new TravelDataError('Trip was inserted, but it is not visible yet. Retry the same trip submission to recover it safely.');
    return tripFromRow(row);
  }

  async updateTrip(id: string, input: Partial<Omit<Trip, 'id' | 'destinations'>>): Promise<Trip> {
    await requireAuthenticatedUser(this.client);
    const update = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.start !== undefined ? { start_date: input.start || null } : {}),
      ...(input.end !== undefined ? { end_date: input.end || null } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };
    const { data, error } = await this.client.from('trips').update(update).eq('id', id).select('*').single();
    return tripFromRow(requireData(data, error, 'Update trip'));
  }

  async deleteTrip(id: string): Promise<void> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('trips').delete().eq('id', id).select('id').single();
    requireData(data, error, 'Delete trip');
  }

  async createDestination(tripId: string, input: DestinationDraft): Promise<Destination> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('destinations').insert(destinationToRow(input, tripId)).select('*').single();
    return destinationFromRow(requireData(data, error, 'Create destination'));
  }

  async updateDestination(tripId: string, id: string, input: Partial<DestinationDraft>): Promise<Destination> {
    await requireAuthenticatedUser(this.client);
    const update = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.date !== undefined ? { planned_date: input.date || null } : {}),
      ...(input.time !== undefined ? { planned_time: input.time || null } : {}),
      ...(input.duration !== undefined ? { duration_minutes: input.duration } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.lat !== undefined ? { latitude: input.lat } : {}),
      ...(input.lng !== undefined ? { longitude: input.lng } : {}),
      ...(input.price !== undefined ? { estimated_cost: input.price } : {}),
      ...(input.visited !== undefined ? { visited: input.visited } : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
    };
    const { data, error } = await this.client.from('destinations').update(update).eq('trip_id', tripId).eq('id', id).select('*').single();
    return destinationFromRow(requireData(data, error, 'Update destination'));
  }

  async deleteDestination(tripId: string, id: string): Promise<void> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('destinations').delete().eq('trip_id', tripId).eq('id', id).select('id').single();
    requireData(data, error, 'Delete destination');
  }

  async reorderDestinations(tripId: string, orderedIds: string[]): Promise<void> {
    await requireAuthenticatedUser(this.client);
    for (const [sortOrder, id] of orderedIds.entries()) {
      const { data, error } = await this.client.from('destinations').update({ sort_order: sortOrder })
        .eq('trip_id', tripId).eq('id', id).select('id').single();
      requireData(data, error, 'Reorder destinations');
    }
  }

  private async findBookingByClientId(tripId: string, clientId: string): Promise<BookingRow | null> {
    const { data, error } = await this.client.from('bookings').select('*').eq('trip_id', tripId).eq('client_id', clientId).maybeSingle();
    throwIfError(error, 'Find booking by client ID');
    return data;
  }

  private async persistBookingDetails(tripId: string, bookingId: string, input: BookingDraft): Promise<{ flight?: FlightRow; accommodation?: AccommodationRow }> {
    let flight: FlightRow | undefined;
    let accommodation: AccommodationRow | undefined;
    if (input.kind === 'Flight' && input.flight) {
      const { data: existing, error: readError } = await this.client.from('flights').select('*').eq('trip_id', tripId).eq('booking_id', bookingId).maybeSingle();
      throwIfError(readError, 'Load flight details');
      const detail = {
        trip_id: tripId, booking_id: bookingId, airline: input.flight.airline.trim(), flight_number: input.flight.flightNumber.trim(),
        departure_airport: input.flight.departureAirport.trim(), arrival_airport: input.flight.arrivalAirport.trim(),
        departure_at: input.flight.departureAt ? new Date(input.flight.departureAt).toISOString() : null,
        arrival_at: input.flight.arrivalAt ? new Date(input.flight.arrivalAt).toISOString() : null,
      };
      const result = existing
        ? await this.client.from('flights').update(detail).eq('id', existing.id).select('*').single()
        : await this.client.from('flights').insert(detail).select('*').single();
      flight = requireData(result.data, result.error, 'Save flight details');
    } else {
      const { error } = await this.client.from('flights').delete().eq('trip_id', tripId).eq('booking_id', bookingId);
      throwIfError(error, 'Remove flight details');
    }
    if (input.kind === 'Accommodation' && input.accommodation) {
      const { data: existing, error: readError } = await this.client.from('accommodations').select('*').eq('trip_id', tripId).eq('booking_id', bookingId).maybeSingle();
      throwIfError(readError, 'Load accommodation details');
      const detail = {
        trip_id: tripId, booking_id: bookingId, property_name: input.accommodation.propertyName.trim(),
        check_in_at: input.accommodation.checkInAt ? new Date(input.accommodation.checkInAt).toISOString() : null,
        check_out_at: input.accommodation.checkOutAt ? new Date(input.accommodation.checkOutAt).toISOString() : null,
        address: input.accommodation.address.trim(),
      };
      const result = existing
        ? await this.client.from('accommodations').update(detail).eq('id', existing.id).select('*').single()
        : await this.client.from('accommodations').insert(detail).select('*').single();
      accommodation = requireData(result.data, result.error, 'Save accommodation details');
    } else {
      const { error } = await this.client.from('accommodations').delete().eq('trip_id', tripId).eq('booking_id', bookingId);
      throwIfError(error, 'Remove accommodation details');
    }
    return { ...(flight ? { flight } : {}), ...(accommodation ? { accommodation } : {}) };
  }

  async createBooking(tripId: string, input: BookingDraft): Promise<Booking> {
    await requireAuthenticatedUser(this.client);
    const clientId = input.clientId ?? newTripClientId();
    const payload = { ...bookingToRow(input, tripId), client_id: clientId };
    let row = await this.findBookingByClientId(tripId, clientId);
    if (row) {
      const { data, error } = await this.client.from('bookings').update(payload).eq('trip_id', tripId).eq('id', row.id).select('*').single();
      row = requireData(data, error, 'Recover booking');
    } else {
      let result: { data: BookingRow | null; error: { code?: string; message: string } | null } | undefined;
      try {
        result = await this.client.from('bookings').insert(payload).select('*').single();
      } catch (insertCause) {
        row = await this.findBookingByClientId(tripId, clientId);
        if (!row) throw new TravelDataError('Booking creation could not be confirmed. Retry the same submission to safely reconcile it.', insertCause);
      }
      if (!row && result?.error?.code === '23505') row = await this.findBookingByClientId(tripId, clientId);
      else if (!row && result?.error) throwIfError(result.error, 'Create booking');
      else if (!row && result?.data) row = result.data;
      if (!row) throw new TravelDataError('Create booking: Supabase returned no row. Retry using the same booking attempt.');
    }
    const details = await this.persistBookingDetails(tripId, row.id, input);
    return bookingFromRelatedRows(row, details.flight, details.accommodation);
  }

  async updateBooking(tripId: string, uiId: string, input: Partial<BookingDraft>): Promise<Booking> {
    await requireAuthenticatedUser(this.client);
    const id = databaseId(uiId);
    const { data: currentRow, error: readError } = await this.client.from('bookings').select('*').eq('trip_id', tripId).eq('id', id).single();
    const current = bookingFromRow(requireData(currentRow, readError, 'Load booking before update'));
    const merged = { ...current, ...input } as BookingDraft;
    validateBookingInput(merged);
    const bookingUpdate = bookingToRow(merged, tripId);
    const { data, error } = await this.client.from('bookings').update({
      kind: bookingUpdate.kind,
      title: bookingUpdate.title,
      booking_date: bookingUpdate.booking_date,
      local_time: bookingUpdate.local_time,
      reference: bookingUpdate.reference,
      address: bookingUpdate.address,
      estimated_cost: bookingUpdate.estimated_cost,
      currency: bookingUpdate.currency,
      notes: bookingUpdate.notes,
      provider: bookingUpdate.provider,
      booking_url: bookingUpdate.booking_url,
      status: bookingUpdate.status,
    }).eq('trip_id', tripId).eq('id', id).select('*').single();
    const row = requireData(data, error, 'Update booking');
    const details = await this.persistBookingDetails(tripId, id, merged);
    return bookingFromRelatedRows(row, details.flight, details.accommodation);
  }

  async deleteBooking(tripId: string, uiId: string): Promise<void> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('bookings').delete().eq('trip_id', tripId).eq('id', databaseId(uiId)).select('id').single();
    requireData(data, error, 'Delete booking');
  }

  async createExpense(tripId: string, input: ExpenseDraft, attemptId = newUuid()): Promise<Expense> {
    await requireAuthenticatedUser(this.client);
    const payload = { id: attemptId, ...expenseToRow(input, tripId) };
    let result: { data: ExpenseRow | null; error: { code?: string; message: string } | null };
    try {
      result = await this.client.from('expenses').insert(payload).select('*').single();
    } catch (cause) {
      const { data, error } = await this.client.from('expenses').select('*').eq('trip_id', tripId).eq('id', attemptId).maybeSingle();
      if (error) throw new TravelDataError(`Expense creation result is uncertain and could not be reconciled. Reload expenses before retrying. (${error.message})`, { cause, error });
      if (data) return expenseFromRow(data);
      throw new TravelDataError('Expense creation could not be confirmed. Retry the same expense attempt to avoid duplicates.', cause);
    }
    if (result.error?.code === '23505') {
      const { data, error } = await this.client.from('expenses').select('*').eq('trip_id', tripId).eq('id', attemptId).single();
      return expenseFromRow(requireData(data, error, 'Reconcile expense'));
    }
    return expenseFromRow(requireData(result.data, result.error, 'Create expense'));
  }

  async listExpenses(tripId: string): Promise<Expense[]> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('expenses').select('*').eq('trip_id', tripId).order('spent_on');
    throwIfError(error, 'Load expenses');
    return (data ?? []).map(expenseFromRow);
  }

  async updateExpense(tripId: string, uiId: string, input: Partial<ExpenseDraft>): Promise<Expense> {
    await requireAuthenticatedUser(this.client);
    const id = databaseId(uiId);
    const { data: currentRow, error: readError } = await this.client.from('expenses').select('*').eq('trip_id', tripId).eq('id', id).single();
    const current = expenseFromRow(requireData(currentRow, readError, 'Load expense before update'));
    const merged = { ...current, ...input };
    const payload = expenseToRow(merged, tripId);
    const { data, error } = await this.client.from('expenses').update(payload).eq('trip_id', tripId).eq('id', id).select('*').single();
    return expenseFromRow(requireData(data, error, 'Update expense'));
  }

  async deleteExpense(tripId: string, uiId: string): Promise<void> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('expenses').delete().eq('trip_id', tripId).eq('id', databaseId(uiId)).select('id').single();
    requireData(data, error, 'Delete expense');
  }

  async canEditTrip(tripId: string): Promise<boolean> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.rpc('can_edit_trip', { target_trip: tripId });
    throwIfError(error, 'Check document edit permission');
    return data === true;
  }

  async listDocuments(tripId: string): Promise<TravelDocument[]> {
    await requireAuthenticatedUser(this.client);
    const { data, error } = await this.client.from('documents').select('*').eq('trip_id', tripId).order('created_at', { ascending: false });
    throwIfError(error, 'Load documents');
    return (data ?? []).map(documentFromRow);
  }

  private async findDocument(tripId: string, documentId: string): Promise<DocumentRow | null> {
    const { data, error } = await this.client.from('documents').select('*').eq('trip_id', tripId).eq('id', documentId).maybeSingle();
    throwIfError(error, 'Find document');
    return data;
  }

  async uploadDocument(tripId: string, file: File, documentId = newUuid()): Promise<TravelDocument> {
    const user = await requireAuthenticatedUser(this.client);
    validateDocumentFile(file);
    const existing = await this.findDocument(tripId, documentId);
    if (existing) return documentFromRow(existing);

    const storagePath = buildDocumentObjectPath(tripId, documentId, file.name);
    let uploadError: { message: string } | null = null;
    try {
      const { error } = await this.client.storage.from(DOCUMENT_BUCKET).upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      uploadError = error;
    } catch (error) {
      uploadError = { message: error instanceof Error ? error.message : 'The upload response was interrupted.' };
    }

    if (uploadError) {
      // A retry with the same document ID may find an object from a successful
      // upload whose response was lost. Reuse it only if authenticated download succeeds.
      const { error: existingObjectError } = await this.client.storage.from(DOCUMENT_BUCKET).download(storagePath);
      if (existingObjectError) throw new TravelDataError(`Upload document: ${uploadError.message}`, uploadError);
    }

    const metadata = {
      id: documentId,
      trip_id: tripId,
      booking_id: null,
      uploaded_by: user.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    };
    try {
      const { data, error } = await this.client.from('documents').insert(metadata).select('*').single();
      return documentFromRow(requireData(data, error, 'Save document metadata'));
    } catch (metadataCause) {
      let reconciled: DocumentRow | null;
      try {
        reconciled = await this.findDocument(tripId, documentId);
      } catch (reconcileCause) {
        throw new TravelDataError(`Document metadata save could not be confirmed. The private file may still exist; retry using the same upload attempt. (${reconcileCause instanceof Error ? reconcileCause.message : 'Follow-up lookup failed.'})`, { metadataCause, reconcileCause });
      }
      if (reconciled) return documentFromRow(reconciled);

      const { error: cleanupError } = await this.client.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
      if (cleanupError) {
        throw new TravelDataError(`Document metadata was not saved, and the uploaded private file could not be cleaned up. Its object path is ${storagePath}. (${cleanupError.message})`, { metadataCause, cleanupError });
      }
      throw metadataCause;
    }
  }

  async downloadDocument(tripId: string, documentId: string): Promise<{ blob: Blob; fileName: string }> {
    await requireAuthenticatedUser(this.client);
    const row = await this.findDocument(tripId, databaseId(documentId));
    if (!row) throw new TravelDataError('Download document: no accessible metadata row was found.');
    const { data, error } = await this.client.storage.from(DOCUMENT_BUCKET).download(row.storage_path);
    if (error) throw new TravelDataError(`Download document: ${error.message}`, error);
    if (!data) throw new TravelDataError('Download document: Storage returned no file.');
    return { blob: data, fileName: row.file_name };
  }

  async deleteDocument(tripId: string, documentId: string): Promise<void> {
    await requireAuthenticatedUser(this.client);
    const id = databaseId(documentId);
    const row = await this.findDocument(tripId, id);
    if (!row) throw new TravelDataError('Delete document: no accessible metadata row was found.');

    const { error: storageError } = await this.client.storage.from(DOCUMENT_BUCKET).remove([row.storage_path]);
    throwIfError(storageError, 'Delete document file');

    const { error: metadataError } = await this.client.from('documents').delete().eq('trip_id', tripId).eq('id', id);
    if (metadataError) {
      throw new TravelDataError(`The file was removed, but its metadata could not be deleted. The document row remains; retry deletion to finish cleanup. (${metadataError.message})`, metadataError);
    }
  }

  /** Idempotent on (owner_id,client_id)/(trip_id,client_id); leaves local data untouched. */
  async importLocalWorkspace(workspace: LocalWorkspace): Promise<{ trips: number; destinations: number; bookings: number }> {
    const user = await requireAuthenticatedUser(this.client);
    let destinationCount = 0;
    let bookingCount = 0;
    for (const trip of workspace.trips) {
      const tripValues = { ...tripToRow({ ...trip, clientId: trip.id }, user.id), client_id: trip.id };
      let tripRow: TripRow | null = null;
      let tripError: { code?: string; message: string } | null = null;
      try {
        ({ error: tripError } = await this.client.from('trips').upsert(tripValues, { onConflict: 'owner_id,client_id', ignoreDuplicates: true }));
      } catch (upsertCause) {
        try {
          tripRow = await this.findTripByOwnerAndClientId(user.id, trip.id);
        } catch (reconciliationError) {
          const detail = reconciliationError instanceof Error ? reconciliationError.message : 'The follow-up lookup failed.';
          throw new TravelDataError(`Import trip result is uncertain. Retry the import to reconcile it by its stable client ID. (${detail})`, {
            upsertCause,
            reconciliationError,
          });
        }
        if (!tripRow) {
          throw new TravelDataError('Import trip result is uncertain and no matching row is visible. Retry the import to reconcile it by its stable client ID.', upsertCause);
        }
      }
      if (tripError?.code === '23505') tripRow = await this.findTripByOwnerAndClientId(user.id, trip.id);
      else throwIfError(tripError, 'Import local trip');
      if (!tripRow) tripRow = await this.findTripByOwnerAndClientId(user.id, trip.id);
      if (!tripRow) throw new TravelDataError('Import local trip: Supabase returned no row for the imported trip.');
      for (const destination of trip.destinations) {
        const values = { ...destinationToRow({ ...destination, clientId: destination.id }, tripRow.id), client_id: destination.id };
        const { error } = await this.client.from('destinations').upsert(values, { onConflict: 'trip_id,client_id', ignoreDuplicates: true });
        throwIfError(error, 'Import local destination');
        destinationCount++;
      }
      for (const booking of workspace.bookings.filter(item => item.id.startsWith(`${trip.id}-`) || trip.id === 'paris-demo')) {
        const clientId = booking.id;
        const values = { ...bookingToRow({ ...booking, clientId }, tripRow.id), client_id: clientId };
        const { error } = await this.client.from('bookings').upsert(values, { onConflict: 'trip_id,client_id', ignoreDuplicates: true });
        throwIfError(error, 'Import local booking');
        bookingCount++;
      }
    }
    return { trips: workspace.trips.length, destinations: destinationCount, bookings: bookingCount };
  }
}

function databaseId(id: string): string {
  return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
}
