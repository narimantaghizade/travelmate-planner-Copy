import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import type { BookingDraft } from '../types';
import {
  bookingFromRelatedRows, expenseFromRow, expenseToRow, validateBookingInput, validateExpenseInput,
  TravelRepository,
} from './travelRepository';

const bookingRow = {
  id:'booking-1', trip_id:'trip-1', client_id:'attempt-1', kind:'Other' as const, title:'Taxi', booking_date:'2026-10-01',
  local_time:'09:15:00', reference:'REF', address:'Station', estimated_cost:17.5, currency:'USD', notes:'Meet outside',
  provider:'City Cars', booking_url:'https://example.test/reservation', status:'confirmed' as const, created_at:'', updated_at:'',
};
const expenseRow = {
  id:'expense-1', trip_id:'trip-1', booking_id:'booking-1', destination_id:'destination-1', title:'Cab fare', amount:17.5,
  currency:'USD', spent_on:'2026-10-01', notes:'', category:'Transport', created_at:'',
};
const validBooking: BookingDraft = {
  kind:'Other', title:'Taxi', date:'2026-10-01', time:'09:15', reference:'REF', address:'Station', price:17.5,
  currency:'USD', notes:'Meet outside', provider:'City Cars', bookingUrl:'https://example.test/reservation', status:'confirmed', clientId:'attempt-1',
};
const validExpense = { category:'Transport', title:'Cab fare', amount:17.5, currency:'USD', date:'2026-10-01', notes:'', bookingId:'trip-1/booking-1', destinationId:'destination-1' };

function client(from: ReturnType<typeof vi.fn>) {
  return { auth:{ getUser:vi.fn().mockResolvedValue({ data:{ user:{ id:'user-1' } }, error:null }) }, from } as unknown as SupabaseClient<Database>;
}
function detailDeleteTable() {
  return { delete:() => ({ eq:() => ({ eq:() => Promise.resolve({ error:null }) }) }) };
}

describe('Stage 3 booking and expense mappings', () => {
  it('maps structured flight and accommodation records from their existing detail tables', () => {
    const flight = { id:'f1', trip_id:'trip-1', booking_id:'booking-1', airline:'Airline', flight_number:'AB12', departure_airport:'WAW', arrival_airport:'CDG', departure_at:'2026-10-01T09:00:00.000Z', arrival_at:'2026-10-01T11:00:00.000Z' };
    const flightBooking = bookingFromRelatedRows({ ...bookingRow, kind:'Flight', provider:'' }, flight);
    expect(flightBooking).toMatchObject({ provider:'Airline', flight:{ flightNumber:'AB12', departureAirport:'WAW', arrivalAirport:'CDG' } });
    const stay = { id:'a1', trip_id:'trip-1', booking_id:'booking-1', property_name:'Apartment', check_in_at:null, check_out_at:null, address:'Rue 1' };
    expect(bookingFromRelatedRows({ ...bookingRow, kind:'Accommodation', provider:'' }, undefined, stay)).toMatchObject({ provider:'Apartment', address:'Rue 1', accommodation:{ propertyName:'Apartment' } });
  });

  it('maps an expense association to its scoped booking id and keeps the currency', () => {
    expect(expenseFromRow(expenseRow)).toMatchObject({ id:'trip-1/expense-1', bookingId:'trip-1/booking-1', destinationId:'destination-1', currency:'USD' });
    expect(expenseToRow(validExpense, 'trip-1')).toMatchObject({ trip_id:'trip-1', booking_id:'booking-1', destination_id:'destination-1', currency:'USD', category:'Transport' });
  });

  it('validates required descriptions, URLs, currency codes, status, and nonnegative amounts', () => {
    expect(() => validateBookingInput(validBooking)).not.toThrow();
    expect(() => validateBookingInput({ ...validBooking, title:' ' })).toThrow('Booking name is required');
    expect(() => validateBookingInput({ ...validBooking, currency:'US' })).toThrow('three-letter');
    expect(() => validateBookingInput({ ...validBooking, bookingUrl:'javascript:alert(1)' })).toThrow('HTTP or HTTPS');
    expect(() => validateBookingInput({ ...validBooking, price:-1 })).toThrow('nonnegative');
    expect(() => validateExpenseInput(validExpense)).not.toThrow();
    expect(() => validateExpenseInput({ ...validExpense, category:' ' })).toThrow('category is required');
    expect(() => validateExpenseInput({ ...validExpense, date:'' })).toThrow('date is required');
    expect(() => validateExpenseInput({ ...validExpense, currency:'EURO' })).toThrow('three-letter');
    expect(() => validateExpenseInput({ ...validExpense, amount:Number.NaN })).toThrow('nonnegative');
  });

  it('creates a booking with a stable client id and exposes its estimate currency', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data:null, error:null });
    const insertSingle = vi.fn().mockResolvedValue({ data:bookingRow, error:null });
    const from = vi.fn((table: string) => table === 'bookings'
      ? { select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }), insert:vi.fn(() => ({ select:() => ({ single:insertSingle }) })) }
      : detailDeleteTable());
    const result = await new TravelRepository(client(from)).createBooking('trip-1', validBooking);
    expect(result).toMatchObject({ id:'trip-1/booking-1', currency:'USD', provider:'City Cars', bookingUrl:'https://example.test/reservation', status:'confirmed' });
    expect(insertSingle).toHaveBeenCalledOnce();
  });

  it('lists, updates and deletes expenses through trip-scoped repository queries', async () => {
    const currentSingle = vi.fn().mockResolvedValue({ data:expenseRow, error:null });
    const updatedSingle = vi.fn().mockResolvedValue({ data:{ ...expenseRow, amount:20 }, error:null });
    const deleteSingle = vi.fn().mockResolvedValue({ data:{ id:'expense-1' }, error:null });
    const listed = vi.fn().mockResolvedValue({ data:[expenseRow], error:null });
    const from = vi.fn(() => ({
      select:() => ({ eq:() => ({ order:listed, eq:() => ({ single:currentSingle }) }) }),
      update:() => ({ eq:() => ({ eq:() => ({ select:() => ({ single:updatedSingle }) }) }) }),
      delete:() => ({ eq:() => ({ eq:() => ({ select:() => ({ single:deleteSingle }) }) }) }),
    }));
    const repo = new TravelRepository(client(from));
    await expect(repo.listExpenses('trip-1')).resolves.toMatchObject([{ bookingId:'trip-1/booking-1' }]);
    await expect(repo.updateExpense('trip-1', 'trip-1/expense-1', { amount:20 })).resolves.toMatchObject({ amount:20, currency:'USD' });
    await expect(repo.deleteExpense('trip-1', 'trip-1/expense-1')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('creates expenses with a stable ID and reconciles an uncertain retry without duplicating', async () => {
    const firstInsert = vi.fn().mockRejectedValue(new TypeError('network interrupted'));
    const existingSingle = vi.fn().mockResolvedValue({ data:expenseRow, error:null });
    const from = vi.fn((table: string) => table === 'expenses'
      ? {
          insert:firstInsert,
          select:() => ({ eq:() => ({ eq:() => ({ maybeSingle:existingSingle }) }) }),
        }
      : detailDeleteTable());
    const repo = new TravelRepository(client(from));
    await expect(repo.createExpense('trip-1', validExpense, 'expense-1')).resolves.toMatchObject({
      id:'trip-1/expense-1', bookingId:'trip-1/booking-1', currency:'USD',
    });
    expect(firstInsert).toHaveBeenCalledOnce();
    expect(existingSingle).toHaveBeenCalledOnce();
  });

  it('creates a booking and preserves structured detail without duplicating on retry', async () => {
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data:null, error:null })
      .mockResolvedValueOnce({ data:bookingRow, error:null });
    const insert = vi.fn().mockRejectedValue(new TypeError('network interrupted'));
    const from = vi.fn((table: string) => table === 'bookings'
      ? { select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }), insert }
      : detailDeleteTable());
    const repo = new TravelRepository(client(from));
    await expect(repo.createBooking('trip-1', validBooking)).resolves.toMatchObject({
      id:'trip-1/booking-1', provider:'City Cars', status:'confirmed',
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('edits and deletes bookings through trip-scoped operations', async () => {
    const currentSingle = vi.fn().mockResolvedValue({ data:bookingRow, error:null });
    const updatedSingle = vi.fn().mockResolvedValue({ data:{ ...bookingRow, provider:'Updated provider' }, error:null });
    const deletedSingle = vi.fn().mockResolvedValue({ data:{ id:'booking-1' }, error:null });
    const from = vi.fn((table: string) => table === 'bookings'
      ? {
          select:() => ({ eq:() => ({ eq:() => ({ single:currentSingle }) }) }),
          update:() => ({ eq:() => ({ eq:() => ({ select:() => ({ single:updatedSingle }) }) }) }),
          delete:() => ({ eq:() => ({ eq:() => ({ select:() => ({ single:deletedSingle }) }) }) }),
        }
      : detailDeleteTable());
    const repo = new TravelRepository(client(from));
    await expect(repo.updateBooking('trip-1', 'trip-1/booking-1', { provider:'Updated provider' }))
      .resolves.toMatchObject({ id:'trip-1/booking-1', provider:'Updated provider', bookingUrl:bookingRow.booking_url });
    await expect(repo.deleteBooking('trip-1', 'trip-1/booking-1')).resolves.toBeUndefined();
    expect(currentSingle).toHaveBeenCalledOnce();
    expect(updatedSingle).toHaveBeenCalledOnce();
    expect(deletedSingle).toHaveBeenCalledOnce();
  });

  it('surfaces denied writes and does not treat them as successful saves', async () => {
    const insertSingle = vi.fn().mockResolvedValue({ data:null, error:{ code:'42501', message:'permission denied by row-level security policy' } });
    const maybeSingle = vi.fn().mockResolvedValue({ data:null, error:null });
    const from = vi.fn((table: string) => table === 'expenses'
      ? { insert:() => ({ select:() => ({ single:insertSingle }) }), select:() => ({ eq:() => ({ eq:() => ({ maybeSingle }) }) }) }
      : detailDeleteTable());
    await expect(new TravelRepository(client(from)).createExpense('trip-1', validExpense, 'stable-expense-id'))
      .rejects.toThrow('Create expense: permission denied by row-level security policy');
    expect(insertSingle).toHaveBeenCalledOnce();
  });
});
