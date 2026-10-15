import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Plane, Map as MapIcon, CalendarDays, Ticket, House, Wallet, FileText, Plus, Search, ExternalLink, Clock3, MapPin, CarFront, Check, Trash2, Menu, X, Compass, Users, ArrowUpRight, ChevronRight, Sparkles, CircleDollarSign, ClipboardList, Pencil, ArrowUp, ArrowDown } from 'lucide-react';
import { sampleTrip, sampleBookings } from './data';
import { isSupabaseConfigured, supabase, supabaseConfigurationError } from './supabase';
import { TravelDataError, TravelRepository } from './data/travelRepository';
import { authUiState, cloudStatusLabel, EMAIL_LINK_COOLDOWN_MS, isRateLimitError, RATE_LIMIT_COOLDOWN_MS, rateLimitMessage, readCooldownUntil, saveCooldownUntil } from './data/authUx';
import type { Trip, Destination, Booking, BookingDraft, BookingKind, Expense, ExpenseDraft, Category } from './types';
import { itineraryDates, moveWithinDay, sortItineraryDestinations } from './data/itinerary';
import { formatCurrency, summarizeExpenses } from './data/expenseTotals';
import { validateBookingInput, validateExpenseInput } from './data/travelRepository';
import { clearNavigationPreference, restoreNavigationPreference, saveNavigationPreference } from './data/navigationPreference';
import type { NavigationSection } from './data/navigationPreference';
import DocumentsPanel from './components/DocumentsPanel';
import { acceptInvitationAndLoadTrip, InvitationAcceptanceError, invitationAuthRedirect, parseInvitation, removeInvitationFromUrl } from './data/invitationAcceptance';
import { sendTripInvitation, type TripInvitationRole } from './data/tripInvitationSending';
import { parseItineraryText, type ItineraryImportDraft } from './data/itineraryImport';

const STORAGE_KEY = 'travelmate-demo-v1';
type Stored = { trips: Trip[]; bookings: Booking[]; expenses: Expense[] };
const emptyStored: Stored = { trips: [], bookings: [], expenses: [] };
function readStored(): Stored {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const parsed = JSON.parse(raw) as Partial<Stored>; if (Array.isArray(parsed.trips) && Array.isArray(parsed.bookings)) return { trips:parsed.trips, bookings:parsed.bookings.map(normalizeBooking), expenses:Array.isArray(parsed.expenses) ? parsed.expenses : [] }; } } catch { /* ignore malformed local demo data */ }
  return { trips: [sampleTrip], bookings: sampleBookings, expenses:[] };
}
function readSavedDemo(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    return Array.isArray(value.trips) && Array.isArray(value.bookings) ? { trips:value.trips, bookings:value.bookings.map(normalizeBooking), expenses:Array.isArray(value.expenses) ? value.expenses : [] } as Stored : null;
  } catch { return null; }
}
function id() { return crypto.randomUUID?.() ?? String(Date.now() + Math.random()); }
function uuid() { return crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => { const value=Math.floor(Math.random()*16); return (character==='x'?value:(value&3)|8).toString(16); }); }
function normalizeBooking(booking: Booking): Booking { return { ...booking, provider:booking.provider ?? '', bookingUrl:booking.bookingUrl ?? '', status:booking.status ?? 'planned', currency:booking.currency ?? 'EUR' }; }
function money(n: number) { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0); }
function blankBooking(kind: BookingKind, date = ''): BookingDraft { return { kind, title:'', date, time:'', reference:'', address:'', price:0, currency:'EUR', notes:'', provider:'', bookingUrl:'', status:'planned', clientId:id(), flight:{airline:'',flightNumber:'',departureAirport:'',arrivalAirport:'',departureAt:'',arrivalAt:''}, accommodation:{propertyName:'',checkInAt:'',checkOutAt:'',address:''} }; }
function blankExpense(date = ''): ExpenseDraft { return { category:'Other', title:'', amount:0, currency:'EUR', date, notes:'', bookingId:null, destinationId:null }; }
function fmtDate(d: string) { if (!d) return 'Date not set'; return new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day:'numeric', month:'short' }); }
function mapsUrl(d: Destination) { const destination = d.address || (d.lat !== null && d.lng !== null ? `${d.lat},${d.lng}` : d.name); return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`; }
function iconFor(category: Category) { return category === 'Restaurant' ? '🍴' : category === 'Accommodation' ? '⌂' : category === 'Parking' ? 'P' : category === 'Airport' ? '✈' : category === 'Transport' ? '↗' : '●'; }
function MapResize() { const map = useMap(); useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 100); return () => clearTimeout(t); }, [map]); return null; }

export default function App() {
  const [data, setData] = useState<Stored>(() => supabase ? emptyStored : readStored());
  const [tripId, setTripId] = useState(data.trips[0]?.id ?? '');
  const [cloudStatus, setCloudStatus] = useState<'local' | 'loading' | 'ready' | 'error'>(supabase ? 'loading' : isSupabaseConfigured ? 'error' : 'local');
  const [cloudError, setCloudError] = useState(supabaseConfigurationError);
  const [authEmail, setAuthEmail] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authUser, setAuthUser] = useState<{ id: string; email?: string } | null>(null);
  const [authResolved, setAuthResolved] = useState(!supabase);
  const [navigationReady, setNavigationReady] = useState(!supabase);
  const [invitation, setInvitation] = useState(() => typeof window === 'undefined' ? { kind: 'absent' as const } : parseInvitation(window.location.search));
  const [invitationStatus, setInvitationStatus] = useState<'idle' | 'accepting' | 'accepted' | 'invalid' | 'authentication' | 'rejected' | 'uncertain' | 'accepted-unavailable' | 'trips-unavailable'>(() => typeof window !== 'undefined' && parseInvitation(window.location.search).kind === 'invalid' ? 'invalid' : 'idle');
  const invitationAttemptRef = useRef<string | null>(null);
  const authUserIdRef = useRef<string | null>(null);
  const [authRequestPending, setAuthRequestPending] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(() => readCooldownUntil(typeof window === 'undefined' ? null : window.sessionStorage));
  const [clockNow, setClockNow] = useState(Date.now());
  const [page, setPage] = useState<NavigationSection>('Overview');
  const [query, setQuery] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [showDestinationForm, setShowDestinationForm] = useState(false);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseAttemptId, setExpenseAttemptId] = useState('');
  const [formError, setFormError] = useState('');
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<TripInvitationRole>('editor');
  const [sharePending, setSharePending] = useState(false);
  const [shareMessage, setShareMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const shareInFlightRef = useRef(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const shareWasOpenRef = useRef(false);
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [tripEditOpen, setTripEditOpen] = useState(false);
  const [tripDraft, setTripDraft] = useState({ name:'', city:'', start:'', end:'', description:'' });
  const [tripName, setTripName] = useState('');
  const [tripCity, setTripCity] = useState('');
  const [pendingTripAttempt, setPendingTripAttempt] = useState<{ clientId: string; name: string; city: string } | null>(null);
  const [tripCreatePending, setTripCreatePending] = useState(false);
  const [editingDestinationId, setEditingDestinationId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importDrafts, setImportDrafts] = useState<ItineraryImportDraft[]>([]);
  const [importPending, setImportPending] = useState(false);
  const importInFlightRef = useRef(false);
  const [newDest, setNewDest] = useState<Omit<Destination, 'id' | 'visited'> & { visited?: boolean }>({ name:'', category:'Attraction', address:'', date: data.trips[0]?.start ?? '', time:'10:00', duration:60, notes:'', priority:'Must visit', lat:48.8566, lng:2.3522, price:0, sortOrder:0 });
  const [newBooking, setNewBooking] = useState<BookingDraft>(() => blankBooking('Ticket', data.trips[0]?.start ?? ''));
  const [newExpense, setNewExpense] = useState<ExpenseDraft>(() => blankExpense(data.trips[0]?.start ?? ''));
  const authenticatedUserId = authUser?.id;
  const cloudLabel = cloudStatusLabel({ hasClient: Boolean(supabase), configured: isSupabaseConfigured, authResolved, hasUser: Boolean(authUser), status: cloudStatus, error: cloudError });
  const trip = data.trips.find(t => t.id === tripId) ?? data.trips[0];
  const destinations = useMemo(() => trip?.destinations ?? [], [trip]);
  const bookings = data.bookings.filter(b => !trip || (supabase ? b.id.startsWith(`${trip.id}/`) : b.id.startsWith(trip.id) || trip.id === 'paris-demo'));
  const expenses = data.expenses.filter(expense => !trip || expense.id.startsWith(`${trip.id}/`));
  const bookingPageItems = bookings.filter(booking => page === 'Flights' ? booking.kind === 'Flight'
    : page === 'Accommodation' ? booking.kind === 'Accommodation'
      : page === 'Transport & parking' ? ['Transfer', 'Transport', 'Parking'].includes(booking.kind)
        : !['Flight', 'Accommodation', 'Transfer', 'Transport', 'Parking'].includes(booking.kind));
  const filtered = destinations.filter(d => `${d.name} ${d.address} ${d.category} ${d.notes}`.toLowerCase().includes(query.toLowerCase()));
  const selected = destinations.find(d => d.id === selectedDestination);
  const expenseSummary = useMemo(() => summarizeExpenses(expenses), [expenses]);
  const estimatedTotals = useMemo(() => {
    const totals = new Map<string, number>();
    totals.set('EUR', destinations.reduce((sum, d) => sum + (Number(d.price) || 0), 0));
    for (const booking of bookings) totals.set(booking.currency, (totals.get(booking.currency) ?? 0) + (Number(booking.price) || 0));
    return [...totals].map(([currency, amount]) => ({ currency, amount })).filter(item => item.amount !== 0);
  }, [destinations, bookings]);
  const sorted = useMemo(() => sortItineraryDestinations(destinations), [destinations]);
  const plannedDays = useMemo(() => itineraryDates(trip?.start ?? '', trip?.end ?? '', destinations), [trip?.start, trip?.end, destinations]);

  useEffect(() => {
    if (shareWasOpenRef.current && !shareDialogOpen) shareButtonRef.current?.focus();
    shareWasOpenRef.current = shareDialogOpen;
  }, [shareDialogOpen]);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const previousUserId = authUserIdRef.current;
      if (previousUserId !== nextUserId) {
        if (previousUserId && !nextUserId) clearNavigationPreference(window.localStorage, previousUserId);
        authUserIdRef.current = nextUserId;
        setNavigationReady(false);
        setData(emptyStored);
        setTripId('');
        setPage('Overview');
      }
      setAuthUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setAuthResolved(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !authResolved) return;
    if (!authenticatedUserId) {
      setData(emptyStored);
      setTripId('');
      setPage('Overview');
      setCloudStatus('error');
      setCloudError('Sign in with Supabase Auth to load cloud trips.');
      setNavigationReady(true);
      return;
    }
    const repository = new TravelRepository(supabase);
    let active = true;
    setCloudStatus('loading');
    repository.listTrips().then(result => {
      if (!active) return;
      const preference = restoreNavigationPreference(window.localStorage, authenticatedUserId, result.trips);
      setData(result);
      setTripId(preference.tripId);
      setPage(preference.section);
      setCloudStatus('ready');
      setCloudError('');
      setNavigationReady(true);
    }).catch(error => {
      if (!active) return;
      setData(emptyStored);
      setTripId('');
      setPage('Overview');
      setCloudStatus('error');
      setCloudError(error instanceof Error ? error.message : 'Could not load cloud trips.');
      setNavigationReady(true);
    });
    return () => { active = false; };
  }, [authResolved, authenticatedUserId]);
  useEffect(() => {
    if (invitation.kind !== 'invalid') return;
    window.history.replaceState(null, '', removeInvitationFromUrl(window.location.href));
    setInvitation({ kind: 'absent' });
  }, [invitation.kind]);
  useEffect(() => {
    if (invitation.kind === 'token' && authResolved && authUser && navigationReady && cloudStatus === 'error') {
      setInvitationStatus('trips-unavailable');
    }
  }, [invitation, authResolved, authUser, navigationReady, cloudStatus]);
  useEffect(() => {
    if (!supabase || invitation.kind !== 'token' || !authResolved || !authUser || !navigationReady || cloudStatus !== 'ready') return;
    const client = supabase;
    const attemptKey = `${authUser.id}:${invitation.token}`;
    if (invitationAttemptRef.current === attemptKey) return;
    invitationAttemptRef.current = attemptKey;
    setInvitationStatus('accepting');
    void acceptInvitationAndLoadTrip(invitation.token, {
      accept: async token => {
        const { data: tripId, error } = await client.rpc('accept_trip_invitation', { invitation_token: token });
        return { tripId, errorCode: error?.code };
      },
      loadTrips: async () => {
        const workspace = await new TravelRepository(client).listTrips();
        return { trips: workspace.trips, value: workspace };
      },
    }).then(result => {
      if (authUserIdRef.current !== authUser.id) return;
      setData(result.workspace);
      setTripId(result.tripId);
      setPage('Overview');
      setCloudStatus('ready');
      setCloudError('');
      setInvitationStatus('accepted');
      window.history.replaceState(null, '', removeInvitationFromUrl(window.location.href));
      setInvitation({ kind: 'absent' });
    }).catch(error => {
      if (authUserIdRef.current !== authUser.id) return;
      const kind = error instanceof InvitationAcceptanceError ? error.kind : 'rejected';
      setInvitationStatus(kind);
      window.history.replaceState(null, '', removeInvitationFromUrl(window.location.href));
      setInvitation({ kind: 'absent' });
    });
  }, [invitation, authResolved, authUser, navigationReady, cloudStatus]);
  useEffect(() => {
    if (!navigationReady) return;
    if (supabase && (!authResolved || !authenticatedUserId || cloudStatus !== 'ready')) return;
    const scope = supabase ? authenticatedUserId : 'demo';
    if (!scope) return;
    saveNavigationPreference(window.localStorage, scope, { tripId, section:page });
  }, [page, tripId, navigationReady, authResolved, authenticatedUserId, cloudStatus]);
  useEffect(() => {
    if (!isSupabaseConfigured) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setInterval(() => {
      const next = readCooldownUntil(window.sessionStorage);
      setCooldownUntil(next);
      setClockNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  async function cloudAction<T>(action: (repository: TravelRepository) => Promise<T>, onSuccess: (value: T) => void, successMessage: string) {
    if (!supabase) return;
    try {
      const value = await action(new TravelRepository(supabase));
      onSuccess(value);
      setCloudStatus('ready');
      setCloudError('');
      setNotice(successMessage);
    } catch (error) {
      setCloudStatus('error');
      setCloudError(error instanceof TravelDataError ? error.message : error instanceof Error ? error.message : 'Cloud request failed.');
    }
  }

  async function requestSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !authEmail.trim() || authRequestPending || authUiState(authResolved, Boolean(authUser)) !== 'signed-out' || cooldownUntil > Date.now()) return;
    setAuthRequestPending(true);
    setAuthMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: authEmail.trim(), options: { emailRedirectTo: invitationAuthRedirect(window.location.href, import.meta.env.BASE_URL) } });
      const now = Date.now();
      const until = now + (error && isRateLimitError(error) ? RATE_LIMIT_COOLDOWN_MS : EMAIL_LINK_COOLDOWN_MS);
      saveCooldownUntil(window.sessionStorage, until);
      setCooldownUntil(until);
      setClockNow(now);
      setAuthMessage(error ? isRateLimitError(error) ? rateLimitMessage() : `Could not send sign-in link: ${error.message}` : 'Check your email for a secure sign-in link. You can request another after the cooldown.');
    } catch (error) {
      if (isRateLimitError(error)) {
        const until = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        saveCooldownUntil(window.sessionStorage, until);
        setCooldownUntil(until);
        setAuthMessage(rateLimitMessage());
      } else {
        setAuthMessage(`Could not send sign-in link: ${error instanceof Error ? error.message : 'Unexpected error.'}`);
      }
    } finally {
      setAuthRequestPending(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) { setCloudError(`Sign out failed: ${error.message}`); return; }
    if (authUser?.id) clearNavigationPreference(window.localStorage, authUser.id);
    setData(emptyStored);
    setTripId('');
    setPage('Overview');
  }

  function openShareDialog() {
    setShareEmail('');
    setShareRole('editor');
    setShareMessage(null);
    setShareDialogOpen(true);
  }

  function closeShareDialog() {
    if (shareInFlightRef.current) return;
    setShareDialogOpen(false);
    setShareMessage(null);
  }

  async function submitTripInvitation(event: React.FormEvent) {
    event.preventDefault();
    const client = supabase;
    if (shareInFlightRef.current || !trip || !client || !authUser) return;

    shareInFlightRef.current = true;
    setSharePending(true);
    setShareMessage(null);
    try {
      let sessionPresent = false;
      try {
        const { data: { session }, error } = await client.auth.getSession();
        sessionPresent = Boolean(session && !error);
      } catch {
        sessionPresent = false;
      }
      if (!sessionPresent) {
        setShareMessage({ kind: 'error', text: 'Your sign-in session is no longer valid. Sign in again before inviting someone.' });
        return;
      }

      let result;
      try {
        result = await sendTripInvitation(
          (functionName, options) => client.functions.invoke(functionName, options),
          { tripId: trip.id, email: shareEmail, role: shareRole },
        );
      } catch {
        result = { kind: 'error' as const, message: 'We could not confirm whether the invitation email was delivered. Check the invitation status before trying again.', uncertain: true };
      }
      if (result.kind === 'sent') {
        const expiry = new Date(result.expiresAt);
        const expiryLabel = Number.isNaN(expiry.getTime()) ? '' : ` It expires ${expiry.toLocaleDateString()}.`;
        setShareMessage({ kind: 'success', text: `Invitation email sent to ${shareEmail.trim()}.${expiryLabel}` });
      } else {
        setShareMessage({ kind: 'error', text: result.message });
      }
    } catch {
      setShareMessage({ kind: 'error', text: 'We could not confirm whether the invitation email was delivered. Check the invitation status before trying again.' });
    } finally {
      shareInFlightRef.current = false;
      setSharePending(false);
    }
  }

  function importBrowserDemo() {
    const workspace = readSavedDemo();
    if (!workspace) { setNotice('No saved browser demo data was found.'); return; }
    void cloudAction(async repository => {
      await repository.importLocalWorkspace(workspace);
      return repository.listTrips();
    }, result => {
      setData(result);
      setTripId(result.trips[0]?.id ?? '');
    }, 'Browser data imported. Local records were retained.');
  }

  function updateTrip(updater: (t: Trip) => Trip) {
    if (!trip) return;
    setData(prev => ({ ...prev, trips: prev.trips.map(t => t.id === trip.id ? updater(t) : t) }));
  }
  function openTripEditor() {
    if (!trip) return;
    setTripDraft({ name:trip.name, city:trip.city, start:trip.start, end:trip.end, description:trip.description });
    setTripEditOpen(true);
  }
  function saveTripEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!trip || !tripDraft.name.trim()) return;
    const edited = { ...tripDraft, name:tripDraft.name.trim(), city:tripDraft.city.trim() };
    if (supabase) {
      void cloudAction(repository => repository.updateTrip(trip.id, edited), updated => {
        setData(previous => ({ ...previous, trips:previous.trips.map(item => item.id === updated.id ? { ...updated, destinations:item.destinations } : item) }));
        setTripEditOpen(false);
      }, 'Trip updated in Supabase');
      return;
    }
    updateTrip(current => ({ ...current, ...edited })); setTripEditOpen(false); setNotice('Trip updated');
  }
  function deleteTrip() {
    if (!trip || !window.confirm(`Delete “${trip.name}” and its destinations and bookings? This cannot be undone.`)) return;
    const deletedId = trip.id;
    const finish = () => {
      const remaining = data.trips.filter(item => item.id !== deletedId);
      setData(previous => ({ trips:previous.trips.filter(item => item.id !== deletedId), bookings:previous.bookings.filter(item => !item.id.startsWith(`${deletedId}/`) && !item.id.startsWith(`${deletedId}-`)), expenses:previous.expenses.filter(item => !item.id.startsWith(`${deletedId}/`)) }));
      setTripId(remaining[0]?.id ?? ''); setPage('Overview');
    };
    if (supabase) {
      void cloudAction(repository => repository.deleteTrip(deletedId), finish, 'Trip deleted from Supabase');
      return;
    }
    finish(); setNotice('Trip deleted');
  }
  function openDestinationEditor(destination: Destination) {
    setEditingDestinationId(destination.id);
    setNewDest({ ...destination });
    setShowDestinationForm(true);
  }
  function openDestinationCreator(date = '') {
    const dayCount = destinations.filter(item => item.date === date).length;
    setEditingDestinationId(null);
    setNewDest({ name:'', category:'Attraction', address:'', date:date || trip?.start || '', time:'10:00', duration:60, notes:'', priority:'Must visit', lat:48.8566, lng:2.3522, price:0, visited:false, sortOrder:dayCount });
    setShowDestinationForm(true);
  }
  function addDestination(e: React.FormEvent) {
    e.preventDefault(); if (!trip || !newDest.name.trim()) return;
    const editing = destinations.find(item => item.id === editingDestinationId);
    const dayCount = destinations.filter(item => item.date === newDest.date && item.id !== editingDestinationId).length;
    const payload = { ...newDest, name:newDest.name.trim(), address:newDest.address.trim(), notes:newDest.notes.trim(), sortOrder:editing && editing.date === newDest.date ? editing.sortOrder : dayCount };
    if (editing) {
      if (supabase) {
        void cloudAction(repository => repository.updateDestination(trip.id, editing.id, payload), updated => {
          updateTrip(current => ({ ...current, destinations:current.destinations.map(item => item.id === updated.id ? updated : item) }));
          setShowDestinationForm(false); setEditingDestinationId(null);
        }, 'Destination updated in Supabase');
        return;
      }
      updateTrip(current => ({ ...current, destinations:current.destinations.map(item => item.id === editing.id ? { ...item, ...payload } : item) }));
      setShowDestinationForm(false); setEditingDestinationId(null); setNotice('Destination updated'); return;
    }
    if (supabase) {
      void cloudAction(repository => repository.createDestination(trip.id, payload), destination => {
        updateTrip(t => ({ ...t, destinations: [...t.destinations, destination] }));
        setShowDestinationForm(false); setSelectedDestination(destination.id);
      }, 'Destination saved to Supabase');
      return;
    }
    const d: Destination = { ...payload, id:id(), visited:false };
    updateTrip(t => ({ ...t, destinations:[...t.destinations, d] })); setShowDestinationForm(false); setSelectedDestination(d.id); setNewDest({ name:'', category:'Attraction', address:'', date:trip.start, time:'10:00', duration:60, notes:'', priority:'Must visit', lat:48.8566, lng:2.3522, price:0 }); setNotice('Destination added');
  }
  function parseItineraryNotes() {
    setFormError('');
    setImportDrafts(parseItineraryText(importText, trip?.start ?? ''));
  }
  async function saveImportedItinerary() {
    if (!trip || importInFlightRef.current || importDrafts.length === 0) return;
    if (importDrafts.some(draft => !draft.name.trim())) {
      setFormError('Every itinerary item needs a name. Add one or remove the blank item before saving.');
      return;
    }
    importInFlightRef.current = true;
    setImportPending(true);
    const orderByDate = new Map<string, number>();
    for (const item of destinations) orderByDate.set(item.date, (orderByDate.get(item.date) ?? 0) + 1);
    let saved = 0;
    try {
      for (const draft of importDrafts) {
        const payload = {
          name: draft.name.trim(), category: draft.category, address: draft.address.trim(), date: draft.date,
          time: draft.time, duration: 0, notes: draft.notes.trim(), priority: 'Optional' as const,
          lat: null, lng: null, price: 0, visited: false, sortOrder: orderByDate.get(draft.date) ?? 0,
        };
        if (!payload.name) continue;
        const created = supabase
          ? await new TravelRepository(supabase).createDestination(trip.id, { ...payload, clientId: uuid() })
          : { ...payload, id: id() };
        updateTrip(current => ({ ...current, destinations: [...current.destinations, created] }));
        orderByDate.set(draft.date, payload.sortOrder + 1);
        saved++;
        setImportDrafts(current => current.filter(item => item !== draft));
      }
      setNotice(`${saved} itinerary ${saved === 1 ? 'item' : 'items'} saved`);
      if (saved === 0) setFormError('Add a name to at least one itinerary item before saving.');
    } catch (error) {
      const message = error instanceof TravelDataError ? error.message : error instanceof Error ? error.message : 'Could not save the itinerary.';
      setCloudStatus('error');
      setCloudError(message);
      setNotice(saved ? `${saved} item${saved === 1 ? '' : 's'} saved; remaining items are still in the review list.` : 'No itinerary items were saved. Your review list is preserved.');
    } finally {
      importInFlightRef.current = false;
      setImportPending(false);
    }
  }
  function bookingInputForSave(input: BookingDraft): BookingDraft {
    return {
      ...input,
      flight: input.kind === 'Flight' ? { ...(input.flight ?? blankBooking('Flight').flight!), airline:input.provider.trim() } : undefined,
      accommodation: input.kind === 'Accommodation' ? { ...(input.accommodation ?? blankBooking('Accommodation').accommodation!), propertyName:input.provider.trim(), address:input.address.trim() } : undefined,
    };
  }
  function openBookingCreator() {
    const kind: BookingKind = page === 'Flights' ? 'Flight' : page === 'Accommodation' ? 'Accommodation' : page === 'Transport & parking' ? 'Transfer' : 'Ticket';
    setEditingBookingId(null); setFormError(''); setNewBooking(blankBooking(kind, trip?.start ?? '')); setShowBookingForm(true);
  }
  function openBookingEditor(booking: Booking) {
    setEditingBookingId(booking.id); setFormError('');
    setNewBooking({ ...booking, clientId:undefined, flight:booking.flight ?? blankBooking('Flight').flight, accommodation:booking.accommodation ?? blankBooking('Accommodation').accommodation });
    setShowBookingForm(true);
  }
  function addBooking(e: React.FormEvent) {
    e.preventDefault(); if (!trip) return;
    const input = bookingInputForSave(newBooking);
    try { validateBookingInput(input); } catch (error) { setFormError(error instanceof Error ? error.message : 'Booking details are invalid.'); return; }
    if (editingBookingId) {
      if (supabase) {
        void cloudAction(repository => repository.updateBooking(trip.id, editingBookingId, input), updated => {
          setData(prev => ({ ...prev, bookings:prev.bookings.map(item => item.id === updated.id ? updated : item) }));
          setShowBookingForm(false); setEditingBookingId(null); setFormError('');
        }, 'Booking updated in Supabase');
        return;
      }
      setData(prev => ({ ...prev, bookings:prev.bookings.map(item => item.id === editingBookingId ? { ...input, id:editingBookingId } as Booking : item) }));
      setShowBookingForm(false); setEditingBookingId(null); setFormError(''); setNotice('Booking updated'); return;
    }
    if (supabase) {
      void cloudAction(repository => repository.createBooking(trip.id, input), booking => {
        setData(prev => ({ ...prev, bookings:[...prev.bookings, booking] }));
        setShowBookingForm(false); setNewBooking(blankBooking('Ticket', trip.start)); setFormError('');
      }, 'Booking saved to Supabase');
      return;
    }
    const booking: Booking = { ...input, id:`${trip.id}-${id()}`, provider:input.provider ?? '', bookingUrl:input.bookingUrl ?? '', status:input.status ?? 'planned', currency:input.currency ?? 'EUR' };
    setData(prev => ({ ...prev, bookings:[...prev.bookings, booking] })); setShowBookingForm(false); setFormError(''); setNotice('Booking added');
  }
  function deleteBooking(booking: Booking) {
    if (!trip || !window.confirm(`Delete booking “${booking.title}”? Linked expenses will be kept and unlinked.`)) return;
    const remove = () => setData(previous => ({ ...previous,
      bookings:previous.bookings.filter(item => item.id !== booking.id),
      expenses:previous.expenses.map(item => item.bookingId === booking.id ? { ...item, bookingId:null } : item),
    }));
    if (supabase) { void cloudAction(repository => repository.deleteBooking(trip.id, booking.id), remove, 'Booking deleted from Supabase'); return; }
    remove(); setNotice('Booking deleted');
  }
  function openExpenseCreator() {
    setEditingExpenseId(null); setExpenseAttemptId(uuid()); setFormError('');
    setNewExpense(blankExpense(trip?.start ?? '')); setShowExpenseForm(true);
  }
  function openExpenseEditor(expense: Expense) {
    setEditingExpenseId(expense.id); setExpenseAttemptId(''); setFormError('');
    setNewExpense({ ...expense }); setShowExpenseForm(true);
  }
  function saveExpense(e: React.FormEvent) {
    e.preventDefault(); if (!trip) return;
    try { validateExpenseInput(newExpense); } catch (error) { setFormError(error instanceof Error ? error.message : 'Expense details are invalid.'); return; }
    if (editingExpenseId) {
      if (supabase) {
        void cloudAction(repository => repository.updateExpense(trip.id, editingExpenseId, newExpense), updated => {
          setData(prev => ({ ...prev, expenses:prev.expenses.map(item => item.id === updated.id ? updated : item) }));
          setShowExpenseForm(false); setEditingExpenseId(null); setFormError('');
        }, 'Expense updated in Supabase'); return;
      }
      setData(prev => ({ ...prev, expenses:prev.expenses.map(item => item.id === editingExpenseId ? { ...newExpense, id:editingExpenseId } : item) }));
      setShowExpenseForm(false); setEditingExpenseId(null); setFormError(''); setNotice('Expense updated'); return;
    }
    if (supabase) {
      void cloudAction(repository => repository.createExpense(trip.id, newExpense, expenseAttemptId), created => {
        setData(prev => ({ ...prev, expenses:[...prev.expenses, created] }));
        setShowExpenseForm(false); setExpenseAttemptId(''); setFormError('');
      }, 'Expense recorded in Supabase'); return;
    }
    const created: Expense = { ...newExpense, id:`${trip.id}/${expenseAttemptId || id()}` };
    setData(prev => ({ ...prev, expenses:[...prev.expenses, created] })); setShowExpenseForm(false); setExpenseAttemptId(''); setFormError(''); setNotice('Expense recorded');
  }
  function deleteExpense(expense: Expense) {
    if (!trip || !window.confirm(`Delete expense “${expense.title}”?`)) return;
    const remove = () => setData(prev => ({ ...prev, expenses:prev.expenses.filter(item => item.id !== expense.id) }));
    if (supabase) { void cloudAction(repository => repository.deleteExpense(trip.id, expense.id), remove, 'Expense deleted from Supabase'); return; }
    remove(); setNotice('Expense deleted');
  }

  function createTrip(e: React.FormEvent) {
    e.preventDefault(); if (!tripName.trim()) return;
    if (tripCreatePending) return;
    if (supabase) {
      const name = tripName.trim();
      const city = tripCity.trim() || 'Destination to be decided';
      const attempt = pendingTripAttempt?.name === name && pendingTripAttempt.city === city
        ? pendingTripAttempt
        : { clientId: id(), name, city };
      setPendingTripAttempt(attempt);
      setTripCreatePending(true);
      void cloudAction(repository => repository.createTrip({ name: attempt.name, city: attempt.city, start: '', end: '', description: '', clientId: attempt.clientId }), created => {
        setData(prev => ({ ...prev, trips: prev.trips.some(item => item.id === created.id) ? prev.trips : [...prev.trips, created] }));
        setTripId(created.id); setPage('Overview'); setNewTripOpen(false); setTripName(''); setTripCity(''); setPendingTripAttempt(null);
      }, 'Trip saved to Supabase').finally(() => setTripCreatePending(false));
      return;
    }
    const t: Trip = { id:id(), name:tripName.trim(), city:tripCity.trim() || 'Destination to be decided', start:'', end:'', description:'', destinations:[] };
    setData(prev => ({ ...prev, trips:[...prev.trips,t] })); setTripId(t.id); setPage('Overview'); setNewTripOpen(false); setTripName(''); setTripCity(''); setNotice('Trip created');
  }
  function toggleVisited(d: Destination) {
    const visited = !d.visited;
    if (supabase && trip) {
      void cloudAction(repository => repository.updateDestination(trip.id, d.id, { visited }), updated => updateTrip(t => ({ ...t, destinations: t.destinations.map(item => item.id === updated.id ? updated : item) })), 'Destination updated in Supabase');
      return;
    }
    updateTrip(t => ({...t, destinations:t.destinations.map(x => x.id === d.id ? {...x, visited} : x)}));
  }
  function removeDestination(d: Destination) {
    const remove = () => {
      updateTrip(t => ({ ...t, destinations:t.destinations.filter(x => x.id !== d.id) }));
      setData(previous => ({ ...previous, expenses:previous.expenses.map(item => item.destinationId === d.id ? { ...item, destinationId:null } : item) }));
      setSelectedDestination(null);
    };
    if (supabase && trip) {
      void cloudAction(repository => repository.deleteDestination(trip.id, d.id), remove, 'Destination deleted from Supabase');
      return;
    }
    remove(); setNotice('Destination removed');
  }
  function moveDestination(destination: Destination, offset: -1 | 1) {
    if (!trip) return;
    const day = sortItineraryDestinations(destinations.filter(item => item.date === destination.date));
    const moved = moveWithinDay(day, destination.id, offset);
    if (moved.every((item, index) => item.id === day[index]?.id)) return;
    const ids = moved.map(item => item.id);
    if (supabase) {
      void cloudAction(async repository => { try { await repository.reorderDestinations(trip.id, ids); return true; } catch (error) { try { const refreshed = await repository.listTrips(); setData(refreshed); } catch { /* retain the last loaded view and report the original write error */ } throw error; } }, () => {
        const order = new Map(moved.map(item => [item.id, item.sortOrder]));
        updateTrip(current => ({ ...current, destinations:current.destinations.map(item => order.has(item.id) ? { ...item, sortOrder:order.get(item.id) } : item) }));
      }, 'Itinerary order saved to Supabase');
      return;
    }
    const order = new Map(moved.map(item => [item.id, item.sortOrder]));
    updateTrip(current => ({ ...current, destinations:current.destinations.map(item => order.has(item.id) ? { ...item, sortOrder:order.get(item.id) } : item) }));
  }

  const nav = [
    { group:'WORKSPACE', items:[{label:'Overview', icon:Compass},{label:'Itinerary',icon:CalendarDays},{label:'Map Explorer',icon:MapIcon},{label:'Destinations',icon:MapPin}] },
    { group:'TRAVEL DETAILS', items:[{label:'Flights',icon:Plane},{label:'Accommodation',icon:House},{label:'Tickets & bookings',icon:Ticket},{label:'Transport & parking',icon:CarFront},{label:'Documents',icon:FileText},{label:'Expenses',icon:Wallet}] },
  ] as const;

  if (!navigationReady) return <div className="app-shell"><main className="main-area"><div className="content"><div className="form-warning cloud-message" role="status">Restoring your trip and section…</div></div></main></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Compass size={22}/></div><div><b>travelmate</b><span>YOUR TRIPS, TOGETHER</span></div><button className="icon-btn close-nav" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
      <button className="trip-switcher" onClick={() => setNewTripOpen(true)}><div className="trip-avatar">{trip?.city?.slice(0,1) ?? 'T'}</div><div className="switcher-copy"><span>ACTIVE TRIP</span><b>{trip?.name ?? 'Create your first trip'}</b></div><Plus size={16}/></button>
      {nav.map(section => <div className="nav-section" key={section.group}><div className="nav-heading">{section.group}</div>{section.items.map(item => <button key={item.label} className={`nav-link ${page === item.label ? 'active' : ''}`} onClick={() => {setPage(item.label);setMobileNav(false);}}><item.icon size={17}/><span>{item.label}</span>{item.label === 'Tickets & bookings' && <span className="nav-count">{data.bookings.length}</span>}</button>)}</div>)}
      <div className="sidebar-bottom"><div className="travel-tip"><div className="tip-icon"><Sparkles size={16}/></div><b>A little more adventure?</b><p>Keep must-visits and optional stops together. Leave room for discoveries.</p><button onClick={() => {setPage('Destinations');setMobileNav(false);}}>Explore your list <ArrowUpRight size={14}/></button></div><div className="profile-row"><div className="profile-avatar">TM</div><div><b>Travel planner</b><span>Local demo workspace</span></div><span className="online-dot"/></div></div>
    </aside>
    {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-btn mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumbs">My trips <ChevronRight size={14}/> <b>{trip?.name ?? 'Your workspace'}</b></div><div className="top-actions"><div className="demo-pill" title={cloudError || cloudLabel}><span/>{cloudLabel}</div>{supabase && authUser && <><button className="share-btn" onClick={importBrowserDemo}>Import local data</button><button className="share-btn" onClick={() => void signOut()}>Sign out</button><button ref={shareButtonRef} className="share-btn" onClick={openShareDialog} disabled={!trip || cloudStatus !== 'ready'} aria-label={`Invite someone to ${trip?.name ?? 'this trip'}`}><Users size={16}/> Share trip</button></>}</div></header>
      <div className="content">
        {(invitation.kind === 'token' || invitationStatus !== 'idle') && <section className="panel invitation-panel" aria-live="polite">
          <div className="panel-header"><div><h2>Trip invitation</h2><p>Accepting an invitation adds this trip to your signed-in TravelMate account.</p></div><Users size={21}/></div>
          {invitationStatus === 'accepting' && <p role="status">Checking your invitation and loading the shared trip…</p>}
          {invitationStatus === 'accepted' && <p role="status">Invitation accepted. The shared trip is now selected.</p>}
          {invitationStatus === 'invalid' && <p className="form-warning" role="alert">This invitation link is invalid or incomplete. Ask the trip owner to send a new invitation.</p>}
          {invitationStatus === 'authentication' && <p className="form-warning" role="alert">Your sign-in session could not be used. Sign in with the invited account and open the invitation link again.</p>}
          {invitationStatus === 'rejected' && <p className="form-warning" role="alert">The invitation could not be accepted. Check that you are signed in with the invited account, or ask the trip owner for help.</p>}
          {invitationStatus === 'uncertain' && <p className="form-warning" role="alert">We could not confirm whether acceptance completed. Do not reopen or reuse this invitation yet. Reload this page to refresh your trip list and check whether it was added.</p>}
          {invitationStatus === 'accepted-unavailable' && <p className="form-warning" role="alert">The invitation was accepted, but TravelMate could not refresh your trips. Reload this page or return to your trip list; do not reopen the same invitation.</p>}
          {invitationStatus === 'trips-unavailable' && <p className="form-warning" role="alert">TravelMate could not load your trips, so the invitation has not been submitted. Check your connection and reload this page to try again.</p>}
          {invitationStatus === 'idle' && invitation.kind === 'token' && <p role="status">{!supabase ? 'Supabase is not configured, so this invitation cannot be accepted here.' : !authResolved ? 'Checking your sign-in session…' : !authUser ? 'Sign in with the email address that received this invitation. The invitation link will be preserved through sign-in.' : !navigationReady || cloudStatus !== 'ready' ? 'Loading your secure trip access…' : 'Your invitation is ready to be checked.'}</p>}
        </section>}
        {isSupabaseConfigured && cloudError && <div className="form-warning cloud-message" role="alert"><FileText size={15}/>Cloud mode is active, and local storage is disabled. {cloudError}</div>}
        {supabase && !authResolved && <div className="form-warning cloud-message" role="status">Checking Supabase session…</div>}
        {supabase && authResolved && authUser && <div className="form-warning cloud-message" role="status">Signed in{authUser.email ? ` as ${authUser.email}` : ''}. Cloud trip access uses this authenticated account.</div>}
        {supabase && authResolved && !authUser && <form className="form-warning cloud-message" onSubmit={requestSignIn}><label>Sign in with a Supabase email link<input type="email" required value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="you@example.com"/></label><button className="secondary-btn" type="submit" disabled={authRequestPending || cooldownUntil > clockNow}>{authRequestPending ? 'Sending…' : cooldownUntil > clockNow ? `Wait ${Math.ceil((cooldownUntil - clockNow) / 1000)}s` : 'Send sign-in link'}</button>{authMessage && <span role="status">{authMessage}</span>}</form>}
        {!trip ? <section className="empty-state"><div className="empty-icon"><Compass size={30}/></div><h2>Your next adventure starts here</h2><p>Create a trip to collect places, tickets, flights and all the little details.</p><button className="primary-btn" onClick={() => setNewTripOpen(true)}><Plus size={16}/> Create your first trip</button></section> : <>
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR TRAVEL WORKSPACE <span className="eyebrow-line"/></div><h1>{page === 'Overview' ? 'Plan something wonderful.' : page}</h1><p className="page-subtitle">{page === 'Overview' ? 'Every detail of your trip, thoughtfully in one place.' : `${trip.name} · ${trip.city}`}</p></div><div className="heading-actions"><button className="secondary-btn" onClick={() => {setPage('Map Explorer');setSelectedDestination(null);}}><MapIcon size={16}/> View map</button><button className="primary-btn" onClick={() => openDestinationCreator()}><Plus size={16}/> Add destination</button></div></div>
        <section className="trip-banner"><div className="banner-art"><div className="sun"/><div className="hill hill-one"/><div className="hill hill-two"/><div className="banner-stamp">TRAVEL<br/>SLOWLY</div></div><div className="banner-content"><div className="trip-label"><span className="tiny-pin"><MapPin size={12}/></span> YOUR NEXT GETAWAY</div><h2>{trip.name}</h2><p><MapPin size={14}/>{trip.city}</p><div className="banner-meta"><span><CalendarDays size={14}/>{trip.start ? fmtDate(trip.start) : 'Dates flexible'}{trip.end ? ` – ${fmtDate(trip.end)}` : ''}</span><span><MapPin size={14}/>{destinations.length} places saved</span></div></div><div className="banner-actions"><button className="banner-edit" onClick={openTripEditor}><Pencil size={13}/> Edit trip</button><button className="banner-edit danger-action" onClick={deleteTrip}><Trash2 size={13}/> Delete trip</button><button className="banner-edit" onClick={() => setNewTripOpen(true)}>Manage trips <ArrowUpRight size={14}/></button></div></section>
        {page === 'Overview' && <>
          <div className="section-title-row"><div><h3>Your trip at a glance</h3><p>A little planning goes a long way.</p></div><button className="text-btn" onClick={() => setPage('Itinerary')}>Full itinerary <ChevronRight size={15}/></button></div>
          <div className="stats-grid"><div className="stat-card"><div className="stat-icon lilac"><MapPin size={18}/></div><div><span>PLACES TO VISIT</span><strong>{destinations.length}</strong><small>{destinations.filter(d=>d.visited).length} completed</small></div><div className="stat-spark">↗</div></div><div className="stat-card"><div className="stat-icon peach"><Ticket size={18}/></div><div><span>BOOKINGS & TICKETS</span><strong>{bookings.length}</strong><small>Flights, stays, entries</small></div><div className="stat-spark">✳</div></div><div className="stat-card"><div className="stat-icon mint"><Wallet size={18}/></div><div><span>ESTIMATED COSTS</span><strong>{estimatedTotals.map(item=>formatCurrency(item.amount,item.currency)).join(' · ') || '—'}</strong><small>Actual expenses tracked separately</small></div><div className="stat-spark">↗</div></div></div>
          <div className="overview-grid"><section className="panel itinerary-panel"><div className="panel-header"><div><h3>Coming up</h3><p>Your next planned stops</p></div><button className="icon-btn" onClick={() => setPage('Itinerary')} aria-label="Open itinerary"><ArrowUpRight size={17}/></button></div>{sorted.slice(0,4).length ? <div className="upcoming-list">{sorted.slice(0,4).map((d,i)=><div className="upcoming-item" key={d.id}><div className="timeline-rail"><div className={`timeline-dot ${d.visited?'done':''}`}>{d.visited?<Check size={12}/>:null}</div>{i < Math.min(sorted.length,4)-1 && <div className="timeline-line"/>}</div><div className="upcoming-main"><div className="upcoming-time">{d.time || 'Time flexible'} <span>·</span> {fmtDate(d.date)}</div><b>{d.name}</b><div className="upcoming-place"><MapPin size={12}/>{d.address || 'Address not added'}</div></div><button className="small-map-btn" onClick={() => {setSelectedDestination(d.id);setPage('Map Explorer');}} aria-label={`View ${d.name} on map`}><ArrowUpRight size={15}/></button></div>)}</div> : <EmptyInline title="No stops planned yet" text="Add a destination to start building your itinerary." onClick={()=>openDestinationCreator()}/>}<button className="panel-footer-link" onClick={() => setPage('Itinerary')}>See full itinerary <ArrowUpRight size={14}/></button></section>
          <section className="panel map-preview"><div className="panel-header"><div><h3>Your places, at a glance</h3><p>Explore your trip on the map</p></div><button className="text-btn" onClick={() => setPage('Map Explorer')}>Open map <ArrowUpRight size={14}/></button></div><div className="mini-map"><MapView destinations={destinations.slice(0,6)} selected={selectedDestination} onSelect={setSelectedDestination}/><div className="map-overlay-label"><MapPin size={13}/> {destinations.length} saved places</div></div><div className="map-legend"><span><i className="legend-dot attraction"/> Attractions</span><span><i className="legend-dot food"/> Food & drink</span><span><i className="legend-dot stay"/> Stay</span></div></section></div>
          <div className="section-title-row lower-title"><div><h3>Keep the details together</h3><p>Everything you need, not scattered across apps.</p></div></div><div className="quick-grid"><QuickCard icon={<Plane size={18}/>} tone="blue" title="Flights" text="Flight numbers, times & boarding passes" action={()=>setPage('Flights')}/><QuickCard icon={<House size={18}/>} tone="coral" title="Where you're staying" text="Address, check-in & host notes" action={()=>setPage('Accommodation')}/><QuickCard icon={<Ticket size={18}/>} tone="gold" title="Tickets & reservations" text="Entry times, QR codes & confirmations" action={()=>setPage('Tickets & bookings')}/><QuickCard icon={<FileText size={18}/>} tone="green" title="Travel documents" text="Keep confirmations in one place" action={()=>setPage('Documents')}/></div>
        </>}
        {page === 'Map Explorer' && <><div className="map-page-tools"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your saved places..."/></div><span className="muted-small">{filtered.length} places shown</span></div><div className="large-map-panel"><MapView destinations={filtered} selected={selectedDestination} onSelect={setSelectedDestination}/></div><div className="destination-list compact-list">{filtered.map(d=><DestinationRow key={d.id} d={d} onSelect={()=>setSelectedDestination(d.id)} onVisited={()=>toggleVisited(d)} onDelete={()=>removeDestination(d)} onEdit={()=>openDestinationEditor(d)}/>)}</div>{selected && <div className="selected-place"><div><span className="tag">{selected.category}</span><h3>{selected.name}</h3><p>{selected.address}</p><p className="muted-small">{fmtDate(selected.date)} · {selected.time} · {selected.duration} min</p></div><div className="selected-actions"><a className="secondary-btn link-btn" href={mapsUrl(selected)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Directions</a><button className="icon-btn" onClick={()=>setSelectedDestination(null)} aria-label="Close selected destination"><X size={17}/></button></div></div>}</>}
        {page === 'Destinations' && <><div className="list-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search places, notes, categories..."/></div><button className="primary-btn" onClick={()=>openDestinationCreator()}><Plus size={16}/> Add place</button></div><div className="destination-list">{filtered.map(d=><DestinationRow key={d.id} d={d} onSelect={()=>{setSelectedDestination(d.id);setPage('Map Explorer');}} onVisited={()=>toggleVisited(d)} onDelete={()=>removeDestination(d)} onEdit={()=>openDestinationEditor(d)}/>)}</div>{filtered.length===0 && <EmptyInline title="No matching destinations" text="Try another search or add a new place." onClick={()=>openDestinationCreator()}/>}</>}
        {page === 'Itinerary' && <><div className="section-title-row"><div><h3>Day-by-day plan</h3><p>Stops use their planned date and saved day order.</p></div><div className="heading-actions"><button className="secondary-btn" onClick={()=>{setImportOpen(value=>!value);setFormError('');}}><FileText size={15}/> Import itinerary</button><button className="primary-btn" onClick={()=>openDestinationCreator()}><Plus size={16}/> Add activity</button></div></div>{importOpen&&<section className="panel itinerary-import-panel" aria-label="Import itinerary"><div className="panel-header"><div><h3>Import itinerary notes</h3><p>Paste notes; TravelMate will split day headings, items and times for you to review.</p></div></div><div className="itinerary-import-body"><label>Travel notes<textarea rows={5} value={importText} onChange={event=>setImportText(event.target.value)} placeholder={'Day 1: Arrive in Paris at 09:00, visit the Louvre at 14:00, dinner at 19:00.'}/></label><div className="import-actions"><button className="secondary-btn" type="button" onClick={parseItineraryNotes} disabled={!importText.trim()}>Prepare review</button></div>{importDrafts.length>0&&<><p className="muted-small">Review and edit every item before saving. Details absent from your notes stay blank; location coordinates are not inferred.</p><div className="import-draft-list">{importDrafts.map((draft,index)=><div className="import-draft" key={`${index}-${draft.name}`}><label>Item name<input value={draft.name} onChange={event=>setImportDrafts(items=>items.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label><label>Date<input type="date" value={draft.date} onChange={event=>setImportDrafts(items=>items.map((item,i)=>i===index?{...item,date:event.target.value}:item))}/></label><label>Time<input type="time" value={draft.time} onChange={event=>setImportDrafts(items=>items.map((item,i)=>i===index?{...item,time:event.target.value}:item))}/></label><label>Address<input value={draft.address} onChange={event=>setImportDrafts(items=>items.map((item,i)=>i===index?{...item,address:event.target.value}:item))}/></label><label>Category<select value={draft.category} onChange={event=>setImportDrafts(items=>items.map((item,i)=>i===index?{...item,category:event.target.value as Category}:item))}>{['Attraction','Restaurant','Accommodation','Parking','Airport','Transport','Other'].map(category=><option key={category}>{category}</option>)}</select></label><label>Notes<textarea rows={2} value={draft.notes} onChange={event=>setImportDrafts(items=>items.map((item,i)=>i===index?{...item,notes:event.target.value}:item))}/></label><button type="button" className="icon-btn" aria-label={`Remove ${draft.name}`} onClick={()=>setImportDrafts(items=>items.filter((_,i)=>i!==index))}><Trash2 size={15}/></button></div>)}</div>{formError&&<p className="form-warning" role="alert">{formError}</p>}<div className="import-actions"><button className="primary-btn" type="button" onClick={()=>void saveImportedItinerary()} disabled={importPending}>{importPending?'Saving…':'Save reviewed items'}</button></div></>}</div></section>}{plannedDays.map(date=>{const items=sorted.filter(d=>d.date===date);return <section className="panel day-panel" key={date}><div className="day-heading"><div className="day-date-icon"><CalendarDays size={18}/></div><div><h3>{fmtDate(date)}</h3><p>{items.length} planned {items.length===1?'stop':'stops'}</p></div><button className="text-btn" onClick={()=>openDestinationCreator(date)}><Plus size={14}/> Add to this day</button></div>{items.map((d,index)=><DestinationRow key={d.id} d={d} onSelect={()=>{setSelectedDestination(d.id);setPage('Map Explorer');}} onVisited={()=>toggleVisited(d)} onDelete={()=>removeDestination(d)} onEdit={()=>openDestinationEditor(d)} onMoveUp={index>0?()=>moveDestination(d,-1):undefined} onMoveDown={index<items.length-1?()=>moveDestination(d,1):undefined}/>)}</section>})}{sorted.filter(d=>!d.date).length>0&&<section className="panel day-panel"><div className="day-heading"><div className="day-date-icon"><CalendarDays size={18}/></div><div><h3>Date to be decided</h3><p>{sorted.filter(d=>!d.date).length} unscheduled stops</p></div></div>{sorted.filter(d=>!d.date).map(d=><DestinationRow key={d.id} d={d} onSelect={()=>{setSelectedDestination(d.id);setPage('Map Explorer');}} onVisited={()=>toggleVisited(d)} onDelete={()=>removeDestination(d)} onEdit={()=>openDestinationEditor(d)}/>)}</section>}{destinations.length===0&&<EmptyInline title="Your itinerary is a blank page" text="Add a destination to start building your itinerary." onClick={()=>openDestinationCreator()}/>}</>}
        {(page === 'Flights' || page === 'Accommodation' || page === 'Tickets & bookings' || page === 'Transport & parking') && <><div className="section-title-row"><div><h3>{page==='Flights'?'Flights':page==='Accommodation'?'Hotels & accommodation':page==='Transport & parking'?'Transport & parking':'Tickets, activities & reservations'}</h3><p>Saved booking amounts are estimates; actual payments belong in Expenses.</p></div><button className="primary-btn" onClick={openBookingCreator}><Plus size={16}/> Add booking</button></div><div className="booking-list">{bookingPageItems.map(booking=><article className="booking-card" key={booking.id}><div className={`booking-icon ${booking.kind==='Flight'?'blue':booking.kind==='Accommodation'?'coral':'gold'}`}>{booking.kind==='Flight'?<Plane size={20}/>:booking.kind==='Accommodation'?<House size={20}/>:<Ticket size={20}/>}</div><div className="booking-info"><div className="booking-kind">{booking.kind} · {booking.status} · {fmtDate(booking.date)} {booking.time}</div><h3>{booking.title}</h3>{booking.provider&&<p>{booking.provider}</p>}{booking.address&&<p><MapPin size={13}/>{booking.address}</p>}{booking.flight&&<p>{booking.flight.flightNumber} · {booking.flight.departureAirport} → {booking.flight.arrivalAirport}</p>}{booking.accommodation&&<p>{booking.accommodation.propertyName} · Check-in {booking.accommodation.checkInAt || 'not set'} · Check-out {booking.accommodation.checkOutAt || 'not set'}</p>}{booking.reference&&<p className="muted-small">Reference: {booking.reference}</p>}{booking.notes&&<p className="booking-notes">{booking.notes}</p>}{booking.bookingUrl&&<a href={booking.bookingUrl} target="_blank" rel="noreferrer">Open booking ↗</a>}</div><div className="booking-price">{formatCurrency(booking.price,booking.currency)}<span>estimated</span><div className="booking-actions"><button className="icon-btn" onClick={()=>openBookingEditor(booking)} aria-label={`Edit ${booking.title}`}><Pencil size={14}/></button><button className="icon-btn" onClick={()=>deleteBooking(booking)} aria-label={`Delete ${booking.title}`}><Trash2 size={14}/></button></div></div></article>)}{bookingPageItems.length===0&&<EmptyInline title="Nothing saved here yet" text="Add booking details to keep them with your trip." onClick={openBookingCreator}/>}</div></>}
        {page === 'Documents' && <DocumentsPanel key={trip.id} tripId={trip.id} authenticated={Boolean(authUser)} onNotice={setNotice}/>}
        {page === 'Expenses' && <><div className="section-title-row"><div><h3>Trip costs</h3><p>Estimated bookings and recorded payments are shown separately.</p></div><button className="primary-btn" onClick={openExpenseCreator}><Plus size={16}/> Record expense</button></div><div className="cost-summary-grid"><section className="panel expense-panel"><div className="panel-header"><div><h3>Estimated costs</h3><p>Planning amounts only, not paid expenses.</p></div></div><div className="cost-row"><span>Destinations & activities (EUR assumed)</span><b>{money(destinations.reduce((sum,item)=>sum+(Number(item.price)||0),0))}</b></div>{bookings.map(booking=><div className="cost-row" key={booking.id}><span>{booking.title} · booking estimate</span><b>{formatCurrency(booking.price,booking.currency)}</b></div>)}</section><section className="panel expense-panel"><div className="panel-header"><div><h3>Actual expenses</h3><p>Totals stay separate by currency.</p></div></div>{expenseSummary.currencies.map(item=><div className="cost-row" key={item.currency}><span>Recorded total · {item.currency}</span><b>{formatCurrency(item.amount,item.currency)}</b></div>)}{expenseSummary.currencies.length===0&&<p className="empty-expenses">No expenses recorded yet.</p>}{expenseSummary.categories.map(item=><div className="cost-row category-cost" key={`${item.currency}-${item.category}`}><span>{item.category} · {item.currency}</span><b>{formatCurrency(item.amount,item.currency)}</b></div>)}</section></div><div className="expense-list">{expenses.map(expense=><article className="booking-card" key={expense.id}><div className="booking-icon gold"><Wallet size={19}/></div><div className="booking-info"><div className="booking-kind">{expense.category} · {fmtDate(expense.date)}</div><h3>{expense.title}</h3>{expense.notes&&<p className="booking-notes">{expense.notes}</p>}{expense.bookingId&&<p className="muted-small">Booking: {bookings.find(item=>item.id===expense.bookingId)?.title ?? 'Linked booking'}</p>}{expense.destinationId&&<p className="muted-small">Place: {destinations.find(item=>item.id===expense.destinationId)?.name ?? 'Linked destination'}</p>}</div><div className="booking-price">{formatCurrency(expense.amount,expense.currency)}<div className="booking-actions"><button className="icon-btn" onClick={()=>openExpenseEditor(expense)} aria-label={`Edit ${expense.title}`}><Pencil size={14}/></button><button className="icon-btn" onClick={()=>deleteExpense(expense)} aria-label={`Delete ${expense.title}`}><Trash2 size={14}/></button></div></div></article>)}</div></>}
        {!['Overview','Map Explorer','Destinations','Itinerary','Flights','Accommodation','Tickets & bookings','Transport & parking','Documents','Expenses'].includes(page) && <section className="panel placeholder-panel"><ClipboardList size={28}/><h2>{page}</h2><p>This section will be available as the application grows. Start with destinations, your itinerary, flights, accommodation and bookings.</p></section>}
        </>}
        <footer className="footer"><span>Made for the journeys worth remembering.</span><span>TRAVELMATE <i>·</i> LOCAL DEMO</span></footer>
      </div>
    </main>
    {tripEditOpen && trip && <Modal title="Edit trip" subtitle="Update this trip’s name, destination and dates." onClose={()=>setTripEditOpen(false)}><form className="form-grid" onSubmit={saveTripEdit}><label className="span-2">Trip name *<input required autoFocus value={tripDraft.name} onChange={e=>setTripDraft({...tripDraft,name:e.target.value})}/></label><label className="span-2">Main destination<input value={tripDraft.city} onChange={e=>setTripDraft({...tripDraft,city:e.target.value})}/></label><label>Start date<input type="date" value={tripDraft.start} max={tripDraft.end || undefined} onChange={e=>setTripDraft({...tripDraft,start:e.target.value})}/></label><label>End date<input type="date" value={tripDraft.end} min={tripDraft.start || undefined} onChange={e=>setTripDraft({...tripDraft,end:e.target.value})}/></label><label className="span-2">Description<textarea rows={3} value={tripDraft.description} onChange={e=>setTripDraft({...tripDraft,description:e.target.value})}/></label><div className="modal-actions span-2"><button type="button" className="secondary-btn" onClick={()=>setTripEditOpen(false)}>Cancel</button><button className="primary-btn" type="submit"><Check size={15}/> Save trip</button></div></form></Modal>}
        {showDestinationForm && <Modal title={editingDestinationId ? "Edit destination" : "Add a destination"} subtitle={editingDestinationId ? "Update its details and planned schedule." : "Save a place now, fill in the details later."} onClose={()=>{setShowDestinationForm(false);setEditingDestinationId(null);}}><form className="form-grid" onSubmit={addDestination}><label className="span-2">Place name *<input required autoFocus value={newDest.name} onChange={e=>setNewDest({...newDest,name:e.target.value})} placeholder="e.g. Louvre Museum"/></label><label>Category<select value={newDest.category} onChange={e=>setNewDest({...newDest,category:e.target.value as Category})}>{['Attraction','Restaurant','Accommodation','Parking','Airport','Transport','Other'].map(c=><option key={c}>{c}</option>)}</select></label><label>Priority<select value={newDest.priority} onChange={e=>setNewDest({...newDest,priority:e.target.value as Destination['priority']})}>{['Must visit','Optional','Backup'].map(c=><option key={c}>{c}</option>)}</select></label><label className="span-2">Address<input value={newDest.address} onChange={e=>setNewDest({...newDest,address:e.target.value})} placeholder="Street, city, country"/></label><label>Date<input type="date" value={newDest.date} onChange={e=>setNewDest({...newDest,date:e.target.value})}/></label><label>Start time<input type="time" value={newDest.time} onChange={e=>setNewDest({...newDest,time:e.target.value})}/></label><label>Visit duration (min)<input type="number" min="0" value={newDest.duration} onChange={e=>setNewDest({...newDest,duration:Number(e.target.value)})}/></label><label>Estimated cost (€)<input type="number" min="0" step="0.01" value={newDest.price} onChange={e=>setNewDest({...newDest,price:Number(e.target.value)})}/></label><label>Latitude<input type="number" step="any" value={newDest.lat ?? ''} onChange={e=>setNewDest({...newDest,lat:e.target.value ? Number(e.target.value) : null})}/></label><label>Longitude<input type="number" step="any" value={newDest.lng ?? ''} onChange={e=>setNewDest({...newDest,lng:e.target.value ? Number(e.target.value) : null})}/></label><div className="form-warning span-2"><MapPin size={15}/> Coordinates aren't inferred from notes. Add them for a map marker; addresses are used for Google Maps directions.</div><label className="span-2">Notes<textarea rows={3} value={newDest.notes} onChange={e=>setNewDest({...newDest,notes:e.target.value})} placeholder="Tickets, opening hours, parking, tips..."/></label><div className="modal-actions span-2"><button type="button" className="secondary-btn" onClick={()=>setShowDestinationForm(false)}>Cancel</button><button className="primary-btn" type="submit">{editingDestinationId ? <><Check size={15}/> Save changes</> : <><Plus size={15}/> Save destination</>}</button></div></form></Modal>}
    {showBookingForm && <Modal title={editingBookingId ? 'Edit booking' : 'Add a booking'} subtitle="Save confirmations and estimates with the trip." onClose={()=>{setShowBookingForm(false);setEditingBookingId(null);setFormError('');}}><form className="form-grid" onSubmit={addBooking}><label className="span-2">Booking name *<input required autoFocus value={newBooking.title} onChange={e=>setNewBooking({...newBooking,title:e.target.value})} placeholder="e.g. Return flight to Kraków"/></label><label>Type<select value={newBooking.kind} onChange={e=>setNewBooking({...newBooking,kind:e.target.value as BookingKind})}>{['Flight','Accommodation','Ticket','Activity','Restaurant','Transfer','Transport','Parking','Other'].map(kind=><option key={kind}>{kind}</option>)}</select></label><label>Status<select value={newBooking.status} onChange={e=>setNewBooking({...newBooking,status:e.target.value as Booking['status']})}>{['planned','confirmed','cancelled','completed'].map(status=><option key={status}>{status}</option>)}</select></label><label>Date<input type="date" value={newBooking.date} onChange={e=>setNewBooking({...newBooking,date:e.target.value})}/></label><label>Local time<input type="time" value={newBooking.time} onChange={e=>setNewBooking({...newBooking,time:e.target.value})}/></label><label>Estimated cost *<input required type="number" min="0" step="0.01" value={newBooking.price} onChange={e=>setNewBooking({...newBooking,price:Number(e.target.value)})}/></label><label>Currency *<input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" value={newBooking.currency} onChange={e=>setNewBooking({...newBooking,currency:e.target.value.toUpperCase()})} placeholder="EUR"/></label><label>Provider / airline / property<input value={newBooking.provider} onChange={e=>setNewBooking({...newBooking,provider:e.target.value})}/></label><label>Booking URL<input type="url" value={newBooking.bookingUrl} onChange={e=>setNewBooking({...newBooking,bookingUrl:e.target.value})} placeholder="https://…"/></label>{newBooking.kind==='Flight'&&<><label>Flight number<input value={newBooking.flight?.flightNumber ?? ''} onChange={e=>setNewBooking({...newBooking,flight:{...newBooking.flight!,flightNumber:e.target.value}})}/></label><label>Departure airport<input value={newBooking.flight?.departureAirport ?? ''} onChange={e=>setNewBooking({...newBooking,flight:{...newBooking.flight!,departureAirport:e.target.value}})}/></label><label>Arrival airport<input value={newBooking.flight?.arrivalAirport ?? ''} onChange={e=>setNewBooking({...newBooking,flight:{...newBooking.flight!,arrivalAirport:e.target.value}})}/></label><label>Departure time<input type="datetime-local" value={newBooking.flight?.departureAt ?? ''} onChange={e=>setNewBooking({...newBooking,flight:{...newBooking.flight!,departureAt:e.target.value}})}/></label><label>Arrival time<input type="datetime-local" value={newBooking.flight?.arrivalAt ?? ''} onChange={e=>setNewBooking({...newBooking,flight:{...newBooking.flight!,arrivalAt:e.target.value}})}/></label></>}{newBooking.kind==='Accommodation'&&<><label>Check-in<input type="datetime-local" value={newBooking.accommodation?.checkInAt ?? ''} onChange={e=>setNewBooking({...newBooking,accommodation:{...newBooking.accommodation!,checkInAt:e.target.value}})}/></label><label>Check-out<input type="datetime-local" value={newBooking.accommodation?.checkOutAt ?? ''} onChange={e=>setNewBooking({...newBooking,accommodation:{...newBooking.accommodation!,checkOutAt:e.target.value}})}/></label></>}<label className="span-2">Address / venue<input value={newBooking.address} onChange={e=>setNewBooking({...newBooking,address:e.target.value,accommodation:newBooking.accommodation?{...newBooking.accommodation,address:e.target.value}:undefined})} placeholder="Address, airport or venue"/></label><label className="span-2">Reference / confirmation number<input value={newBooking.reference} onChange={e=>setNewBooking({...newBooking,reference:e.target.value})}/></label><label className="span-2">Notes<textarea rows={3} value={newBooking.notes} onChange={e=>setNewBooking({...newBooking,notes:e.target.value})}/></label>{formError&&<div className="form-warning span-2" role="alert">{formError}</div>}<div className="modal-actions span-2"><button type="button" className="secondary-btn" onClick={()=>{setShowBookingForm(false);setEditingBookingId(null);}}>Cancel</button><button className="primary-btn" type="submit"><Check size={15}/> {editingBookingId?'Save changes':'Save booking'}</button></div></form></Modal>}
    {showExpenseForm && <Modal title={editingExpenseId?'Edit expense':'Record an expense'} subtitle="Actual payments are stored separately from estimates." onClose={()=>{setShowExpenseForm(false);setEditingExpenseId(null);setFormError('');}}><form className="form-grid" onSubmit={saveExpense}><label className="span-2">Description *<input required autoFocus value={newExpense.title} onChange={e=>setNewExpense({...newExpense,title:e.target.value})} placeholder="e.g. Museum tickets"/></label><label>Category *<input required value={newExpense.category} onChange={e=>setNewExpense({...newExpense,category:e.target.value})} placeholder="Food, transport, activity…"/></label><label>Date<input type="date" value={newExpense.date} onChange={e=>setNewExpense({...newExpense,date:e.target.value})}/></label><label>Amount *<input required type="number" min="0" step="0.01" value={newExpense.amount} onChange={e=>setNewExpense({...newExpense,amount:Number(e.target.value)})}/></label><label>Currency *<input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" value={newExpense.currency} onChange={e=>setNewExpense({...newExpense,currency:e.target.value.toUpperCase()})} placeholder="EUR"/></label><label className="span-2">Related booking (optional)<select value={newExpense.bookingId ?? ''} onChange={e=>setNewExpense({...newExpense,bookingId:e.target.value || null})}><option value="">None</option>{bookings.map(booking=><option key={booking.id} value={booking.id}>{booking.title}</option>)}</select></label><label className="span-2">Related destination (optional)<select value={newExpense.destinationId ?? ''} onChange={e=>setNewExpense({...newExpense,destinationId:e.target.value || null})}><option value="">None</option>{destinations.map(destination=><option key={destination.id} value={destination.id}>{destination.name}</option>)}</select></label><label className="span-2">Notes<textarea rows={3} value={newExpense.notes} onChange={e=>setNewExpense({...newExpense,notes:e.target.value})}/></label>{formError&&<div className="form-warning span-2" role="alert">{formError}</div>}<div className="modal-actions span-2"><button type="button" className="secondary-btn" onClick={()=>{setShowExpenseForm(false);setEditingExpenseId(null);}}>Cancel</button><button className="primary-btn" type="submit"><Check size={15}/> {editingExpenseId?'Save changes':'Record expense'}</button></div></form></Modal>}
    {newTripOpen && <Modal title="Manage your trips" subtitle="Create another trip or switch between your plans." onClose={()=>setNewTripOpen(false)}><div className="trip-modal-list">{data.trips.map(t=><button key={t.id} className={`trip-modal-row ${t.id===tripId?'chosen':''}`} onClick={()=>{setTripId(t.id);setNewTripOpen(false);setPage('Overview');}}><div className="trip-avatar">{t.city.slice(0,1)}</div><div><b>{t.name}</b><span>{t.city} · {t.destinations.length} places</span></div>{t.id===tripId&&<Check size={16}/>}</button>)}</div><form className="form-grid trip-create-form" onSubmit={createTrip}><div className="form-divider span-2"><span>CREATE A NEW TRIP</span></div><label className="span-2">Trip name *<input required value={tripName} onChange={e=>setTripName(e.target.value)} placeholder="e.g. Summer in Greece"/></label><label className="span-2">Main destination<input value={tripCity} onChange={e=>setTripCity(e.target.value)} placeholder="e.g. Santorini, Greece"/></label><div className="modal-actions span-2"><button type="button" className="secondary-btn" onClick={()=>setNewTripOpen(false)}>Close</button><button className="primary-btn" type="submit" disabled={tripCreatePending}>{tripCreatePending ? 'Saving…' : <><Plus size={15}/> Create trip</>}</button></div></form></Modal>}
    {shareDialogOpen && trip && <Modal title="Invite someone to this trip" subtitle="The trip owner can invite a collaborator by email." onClose={closeShareDialog} canClose={!sharePending}><form className="form-grid" onSubmit={submitTripInvitation}>
      <label className="span-2" htmlFor="invitation-email">Recipient email *<input id="invitation-email" type="email" autoComplete="email" required maxLength={254} autoFocus value={shareEmail} onChange={event=>setShareEmail(event.target.value)} placeholder="friend@example.com" disabled={sharePending}/></label>
      <label className="span-2" htmlFor="invitation-role">Access level<select id="invitation-role" value={shareRole} onChange={event=>setShareRole(event.target.value as TripInvitationRole)} disabled={sharePending}><option value="editor">Editor — can make trip changes</option><option value="viewer">Viewer — can view the trip</option></select></label>
      <p className="span-2 muted-small">Only trip owners can send invitations. TravelMate verifies your permission securely when you submit.</p>
      {shareMessage && <div className={`${shareMessage.kind === 'success' ? 'form-success' : 'form-warning'} span-2`} role={shareMessage.kind === 'success' ? 'status' : 'alert'} aria-live="polite">{shareMessage.text}</div>}
      <div className="modal-actions span-2"><button type="button" className="secondary-btn" onClick={closeShareDialog} disabled={sharePending}>Close</button><button className="primary-btn" type="submit" disabled={sharePending || !shareEmail.trim()}><Users size={15}/>{sharePending ? 'Sending invitation…' : 'Send invitation'}</button></div>
    </form></Modal>}
    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
  </div>;
}

function MapView({destinations, selected, onSelect}:{destinations:Destination[];selected:string|null;onSelect:(id:string)=>void}) {
  const located = destinations.filter(d => d.lat !== null && d.lng !== null);
  const center: [number,number] = located.length ? [located[0].lat!,located[0].lng!] : [48.8566,2.3522];
  const points = located.map(d=>[d.lat!,d.lng!] as [number,number]);
  return <MapContainer center={center} zoom={12} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><MapResize/>{points.length>1&&<Polyline positions={points} pathOptions={{color:'#527c70',weight:3,dashArray:'6 7',opacity:.8}}/>}{located.map((d,i)=><Marker key={d.id} position={[d.lat!,d.lng!]} icon={L.divIcon({className:'custom-marker-wrap',html:`<div class="custom-marker ${selected===d.id?'marker-selected':''}">${i+1}</div>`,iconSize:[30,36],iconAnchor:[15,34]})} eventHandlers={{click:()=>onSelect(d.id)}}><Popup><div className="map-popup"><b>{d.name}</b><span>{d.category} · {d.time || 'Time flexible'}</span><a href={mapsUrl(d)} target="_blank" rel="noreferrer">Open directions ↗</a></div></Popup></Marker>)}</MapContainer>;
}
function DestinationRow({d,onSelect,onVisited,onDelete,onEdit,onMoveUp,onMoveDown}:{d:Destination;onSelect:()=>void;onVisited:()=>void;onDelete:()=>void;onEdit:()=>void;onMoveUp?:()=>void;onMoveDown?:()=>void}) { return <article className={`destination-row ${d.visited?'visited':''}`}><button className="dest-emoji" onClick={onSelect} aria-label={`Open ${d.name}`}>{iconFor(d.category)}</button><button className="dest-info" onClick={onSelect}><div className="dest-tags"><span className="tag">{d.category}</span><span className={`priority ${d.priority==='Must visit'?'priority-must':''}`}>{d.priority}</span></div><b>{d.name}</b><span className="dest-address"><MapPin size={12}/>{d.address || 'Add an address'}</span>{d.notes&&<span className="dest-notes">{d.notes}</span>}</button><div className="dest-meta"><span><CalendarDays size={13}/>{fmtDate(d.date)}</span><span><Clock3 size={13}/>{d.time || 'Flexible'}</span>{d.price>0&&<span><CircleDollarSign size={13}/>{money(d.price)}</span>}</div><div className="dest-row-actions">{onMoveUp&&<button onClick={onMoveUp} title="Move earlier in this day" aria-label={`Move ${d.name} earlier`}><ArrowUp size={15}/></button>}{onMoveDown&&<button onClick={onMoveDown} title="Move later in this day" aria-label={`Move ${d.name} later`}><ArrowDown size={15}/></button>}<a href={mapsUrl(d)} target="_blank" rel="noreferrer" title="Open Google Maps" onClick={e=>e.stopPropagation()}><ExternalLink size={15}/></a><button onClick={onEdit} title="Edit destination" aria-label={`Edit ${d.name}`}><Pencil size={15}/></button><button onClick={onVisited} title={d.visited?'Mark as not visited':'Mark as visited'}>{d.visited?<Check size={16}/>:<Check size={15}/>}</button><button onClick={onDelete} title="Delete destination"><Trash2 size={15}/></button></div></article>; }

function QuickCard({icon,tone,title,text,action}:{icon:React.ReactNode;tone:string;title:string;text:string;action:()=>void}) { return <button className="quick-card" onClick={action}><div className={`quick-icon ${tone}`}>{icon}</div><div><b>{title}</b><p>{text}</p></div><ChevronRight size={16}/></button>; }
function EmptyInline({title,text,onClick}:{title:string;text:string;onClick:()=>void}) { return <div className="empty-inline"><div className="empty-inline-icon"><Compass size={20}/></div><b>{title}</b><p>{text}</p><button className="text-btn" onClick={onClick}>Get started <ArrowUpRight size={14}/></button></div>; }
function Modal({title,subtitle,onClose,canClose=true,children}:{title:string;subtitle:string;onClose:()=>void;canClose?:boolean;children:React.ReactNode}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function requestClose() {
    if (!canClose) return;
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }

  return <dialog
    ref={dialogRef}
    className="modal-backdrop"
    aria-labelledby="travelmate-dialog-title"
    aria-describedby="travelmate-dialog-description"
    onCancel={event => { event.preventDefault(); requestClose(); }}
    onClick={event => { if (event.target === event.currentTarget) requestClose(); }}
  ><section className="modal"><div className="modal-heading"><div><h2 id="travelmate-dialog-title">{title}</h2><p id="travelmate-dialog-description">{subtitle}</p></div><button type="button" className="icon-btn" onClick={requestClose} aria-label="Close dialog" disabled={!canClose}><X size={18}/></button></div>{children}</section></dialog>;
}
