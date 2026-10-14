import type { Trip, Booking } from './types';
export const sampleTrip: Trip = {
  id: 'paris-demo', name: 'A few days in Paris', city: 'Paris, France', start: '2026-10-17', end: '2026-10-20', description: 'A shared city break with room for spontaneous discoveries.',
  destinations: [
    { id:'d1', name:'Louvre Museum', category:'Attraction', address:'Rue de Rivoli, Paris, France', date:'2026-10-18', time:'10:00', duration:180, notes:'Check ticket entry time. Prioritize the Denon Wing.', priority:'Must visit', lat:48.8606, lng:2.3376, price:32, visited:false },
    { id:'d2', name:'Eiffel Tower', category:'Attraction', address:'Champ de Mars, Paris, France', date:'2026-10-17', time:'17:00', duration:120, notes:'Check sunset time and ticket availability.', priority:'Must visit', lat:48.8584, lng:2.2945, price:0, visited:false },
    { id:'d3', name:'Le Relais de l’Entrecôte', category:'Restaurant', address:'15 Rue Marbeuf, Paris, France', date:'2026-10-17', time:'13:00', duration:90, notes:'Lunch plan. Confirm which location and opening hours.', priority:'Must visit', lat:48.8698, lng:2.3036, price:35, visited:false },
    { id:'d4', name:'Accommodation', category:'Accommodation', address:'Add your Airbnb address here', date:'2026-10-17', time:'15:00', duration:30, notes:'Add check-in instructions privately after setting up an account.', priority:'Must visit', lat:48.8566, lng:2.3522, price:0, visited:false },
    { id:'d5', name:'Parking / transfer option', category:'Parking', address:'Add a confirmed parking address', date:'2026-10-17', time:'12:00', duration:15, notes:'Example placeholder — replace with your actual plan.', priority:'Optional', lat:48.853, lng:2.3499, price:0, visited:false },
  ]
};
export const sampleBookings: Booking[] = [
  {id:'b1',kind:'Flight',title:'Arrival flight — add flight number',date:'2026-10-17',time:'09:00',reference:'',address:'Paris-Beauvais Airport (BVA)',price:0,currency:'EUR',provider:'',bookingUrl:'',status:'planned',notes:'Demo data only. Add airline, terminal, baggage and ticket details.'},
  {id:'b2',kind:'Accommodation',title:'Airbnb / apartment',date:'2026-10-17',time:'15:00',reference:'',address:'Add private property address',price:0,currency:'EUR',provider:'',bookingUrl:'',status:'planned',notes:'Add confirmation reference and check-in details after login is configured.'},
  {id:'b3',kind:'Flight',title:'Return flight',date:'2026-10-20',time:'22:35',reference:'',address:'Paris-Beauvais Airport (BVA)',price:0,currency:'EUR',provider:'',bookingUrl:'',status:'planned',notes:'Plan the transfer to the airport and leave enough buffer.'},
];
