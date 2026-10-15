import { describe, expect, it } from 'vitest';
import { parseItineraryText } from './itineraryImport';

describe('pasted itinerary parsing', () => {
  it('splits day notes into editable items and assigns only implied date and time', () => {
    expect(parseItineraryText('Day 1: Arrive in Paris at 09:00, visit the Louvre at 14:00, dinner at 19:00.', '2026-10-15'))
      .toMatchObject([
        { name: 'Arrive in Paris', date: '2026-10-15', time: '09:00', category: 'Other', address: '', notes: '' },
        { name: 'visit the Louvre', date: '2026-10-15', time: '14:00' },
        { name: 'dinner', date: '2026-10-15', time: '19:00' },
      ]);
  });

  it('advances dates by day number and accepts explicit day dates', () => {
    const items = parseItineraryText('Day 2: Museum\nDay 3 (2026-10-20): Train', '2026-10-15');
    expect(items.map(item => item.date)).toEqual(['2026-10-16', '2026-10-20']);
  });

  it('does not invent a date for notes without a day or trip start', () => {
    expect(parseItineraryText('Pick up keys at 08:30')).toEqual([
      { name: 'Pick up keys', date: '', time: '08:30', address: '', notes: '', category: 'Other', dayNumber: 0 },
    ]);
  });

  it('imports a complete four-day Paris plan without turning headings or dates into activities', () => {
    const notes = `Day 1: Paris — Saturday, 17 October 2026
17 October 2026
08:00 — Arrivée à Paris
Address: Gare du Nord
Notes: Mon ami rejoint le groupe ici; garder les billets dans le sac bleu.
13:00 — Lunch at Le Relais de l’Entrecôte
15 Rue Marbeuf, 75008 Paris
Musée Rodin, 77 Rue de Varenne, 75007 Paris

Day 2: Paris — Sunday, 18 October 2026
18 October 2026
09:30 — Visite du Musée d’Orsay
Adresse: 1 Rue de la Légion d’Honneur, 75007 Paris
Flâner dans le Jardin des Tuileries

Day 3: Paris — Monday, 19 October 2026
19 October 2026
10:00 — Sainte-Chapelle
4 Boulevard du Palais, 75001 Paris
Pause café — vérifier si Camille peut nous rejoindre.

Day 4: Paris — Tuesday, 20 October 2026
20 October 2026
08:15 — Départ de l’hôtel
Retour à la Gare du Nord`;

    const items = parseItineraryText(notes);
    expect(items).toHaveLength(9);
    expect(items.map(item => item.name)).toEqual([
      'Arrivée à Paris',
      'Lunch at Le Relais de l’Entrecôte',
      'Musée Rodin',
      'Visite du Musée d’Orsay',
      'Flâner dans le Jardin des Tuileries',
      'Sainte-Chapelle',
      'Pause café — vérifier si Camille peut nous rejoindre.',
      'Départ de l’hôtel',
      'Retour à la Gare du Nord',
    ]);
    expect(items.map(item => item.date)).toEqual([
      '2026-10-17', '2026-10-17', '2026-10-17',
      '2026-10-18', '2026-10-18',
      '2026-10-19', '2026-10-19',
      '2026-10-20', '2026-10-20',
    ]);
    expect(items[0]).toMatchObject({ time: '08:00', address: 'Gare du Nord', notes: 'Mon ami rejoint le groupe ici; garder les billets dans le sac bleu.' });
    expect(items[1]).toMatchObject({ time: '13:00', address: '15 Rue Marbeuf, 75008 Paris' });
    expect(items[2]).toMatchObject({ time: '', address: '77 Rue de Varenne, 75007 Paris' });
    expect(items[3]).toMatchObject({ time: '09:30', address: '1 Rue de la Légion d’Honneur, 75007 Paris' });
    expect(items[5]).toMatchObject({ time: '10:00', address: '4 Boulevard du Palais, 75001 Paris' });
    expect(items.some(item => /^(?:Paris —|\d{1,2} October)/.test(item.name))).toBe(false);
  });

  it('keeps date-only lines as metadata and leaves the date blank when it is unknown', () => {
    const items = parseItineraryText('Day 1: Paris — Saturday\n18 October 2026\nMusée Rodin');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Musée Rodin', date: '2026-10-18' });
    expect(parseItineraryText('Day 1: Paris — Saturday\nMusée Rodin')[0].date).toBe('');
  });

  it('keeps each named Paris location as its own activity, including address-first and untimed entries', () => {
    const notes = `Day 1: Paris — Saturday, 17 October 2026
17 October 2026
16:00 — Musée Rodin, 77 Rue de Varenne, 75007 Paris
18:00 — Avenue de Camoëns, 75016 Paris — priority Eiffel Tower photo spot
18:30 — Trocadéro staircase and gardens — Eiffel Tower photos
19:00 — Eiffel Tower and Champ de Mars — photos and videos
20:00 — Champs-Élysées and Arc de Triomphe — sightseeing
12:30 — 49 Rue de Richelieu — mirror-selfie photo stop
14:00 — 28 Rue du Bac — photo stop

Day 2: Paris — Sunday, 18 October 2026
13:00 — Photobooth at 53 Rue des Trois Frères, 75018 Paris
13:30 — 54 Rue Lepic, 75018 Paris — photo stop

Day 4: Auvers-sur-Oise — Tuesday
Van Gogh's grave at the Cemetery of Auvers-sur-Oise on Day 4`;

    const items = parseItineraryText(notes);

    expect(items).toHaveLength(10);
    expect(items.map(({ name, time, dayNumber }) => [name, time, dayNumber])).toEqual([
      ['Musée Rodin', '16:00', 1],
      ['Avenue de Camoëns', '18:00', 1],
      ['Trocadéro staircase and gardens', '18:30', 1],
      ['Eiffel Tower and Champ de Mars', '19:00', 1],
      ['Champs-Élysées and Arc de Triomphe', '20:00', 1],
      ['49 Rue de Richelieu', '12:30', 1],
      ['28 Rue du Bac', '14:00', 1],
      ['Photobooth', '13:00', 2],
      ['54 Rue Lepic', '13:30', 2],
      ["Van Gogh's grave at the Cemetery of Auvers-sur-Oise on Day 4", '', 4],
    ]);
    expect(items.map(item => item.address)).toEqual([
      '77 Rue de Varenne, 75007 Paris',
      'Avenue de Camoëns, 75016 Paris',
      '', '', '',
      '49 Rue de Richelieu',
      '28 Rue du Bac',
      '53 Rue des Trois Frères, 75018 Paris',
      '54 Rue Lepic, 75018 Paris',
      '',
    ]);
    expect(items.map(item => item.notes)).toEqual([
      '',
      'priority Eiffel Tower photo spot',
      'Eiffel Tower photos',
      'photos and videos',
      'sightseeing',
      'mirror-selfie photo stop',
      'photo stop',
      '',
      'photo stop',
      '',
    ]);
    expect(items.map(item => item.date)).toEqual([
      '2026-10-17', '2026-10-17', '2026-10-17', '2026-10-17', '2026-10-17',
      '2026-10-17', '2026-10-17', '2026-10-18', '2026-10-18', '',
    ]);
    expect(items.some(item => /^(?:Paris —|\d{1,2} October)/.test(item.name))).toBe(false);
  });

  it('attaches address and labeled note continuation lines to the preceding activity', () => {
    const items = parseItineraryText(`Day 1: Paris — Saturday
16:00 — Musée Rodin
77 Rue de Varenne, 75007 Paris
Notes: acheter les billets à l’avance — entrée côté jardin`);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Musée Rodin',
      address: '77 Rue de Varenne, 75007 Paris',
      notes: 'acheter les billets à l’avance — entrée côté jardin',
      date: '',
    });
  });

  it('keeps untimed address-first photo stops as separate activities', () => {
    const items = parseItineraryText(`Day 1: Paris — Saturday
49 Rue de Richelieu — mirror-selfie photo stop
28 Rue du Bac — photo stop`);

    expect(items).toHaveLength(2);
    expect(items).toMatchObject([
      { name: '49 Rue de Richelieu', address: '49 Rue de Richelieu', time: '', date: '', notes: 'mirror-selfie photo stop' },
      { name: '28 Rue du Bac', address: '28 Rue du Bac', time: '', date: '', notes: 'photo stop' },
    ]);
  });

  it('strips only terminal sentence punctuation from names, preserving address and note punctuation', () => {
    const items = parseItineraryText(`Day 1: Paris — Saturday
19:00 — Dîner au Café de Flore.
20:00 — 53 Rue des Trois Frères, 75018 Paris.
Notes: L’adresse est importante; garder l’apostrophe dans l’hôtel.`);

    expect(items).toMatchObject([
      { name: 'Dîner au Café de Flore', time: '19:00' },
      { name: '53 Rue des Trois Frères', address: '53 Rue des Trois Frères, 75018 Paris.', time: '20:00' },
    ]);
    expect(items[1].notes).toBe('L’adresse est importante; garder l’apostrophe dans l’hôtel.');
  });
});
