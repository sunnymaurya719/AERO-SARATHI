import type { LucideIcon } from 'lucide-react';
import { Car, Crown, Truck, Bus, Users, Zap } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VehicleSlug = 'sedan' | 'suv' | 'innova' | 'premium' | 'tempo' | 'minibus';
export type VehicleCategory = 'economy' | 'comfort' | 'luxury' | 'group';

export interface VehicleDef {
  slug: VehicleSlug;
  Icon: LucideIcon;
  name: string;
  models: string;
  tagline: string;
  category: VehicleCategory;
  categoryLabel: string;
  tag?: string;
  featured?: boolean;
  pax: number;
  luggageBags: number;
  ac: string;
  pricePerKmFrom: number; // ₹
  pricePerKmTo: number;
  airportStartFrom: number; // ₹ — typical Punjab→Delhi run
  perks: string[];
  inclusions: string[];
  samplePricing: { route: string; amount: number }[];
  bestFor: string[];
}

export interface CompareRow {
  feature: string;
  sedan: string | boolean;
  suv: string | boolean;
  innova: string | boolean;
  premium: string | boolean;
  tempo: string | boolean;
  minibus: string | boolean;
}

export interface UseCaseDef {
  Icon: LucideIcon;
  title: string;
  desc: string;
  vehicles: string[];
}

// ── Vehicles ──────────────────────────────────────────────────────────────────

export const VEHICLES: VehicleDef[] = [
  {
    slug: 'innova',
    Icon: Car,
    name: 'Innova Crysta',
    models: 'Toyota Innova Crysta 2.4 GX / VX',
    tagline:
      "Punjab's most trusted long-distance cab. Spacious, smooth, and built for highway comfort.",
    category: 'comfort',
    categoryLabel: 'Comfort SUV',
    tag: 'Most Booked',
    featured: true,
    pax: 7,
    luggageBags: 4,
    ac: 'Dual-zone AC',
    pricePerKmFrom: 22,
    pricePerKmTo: 26,
    airportStartFrom: 2800,
    perks: ['Captain seats', 'Extra luggage space', 'USB charging', 'Toll & permit included'],
    inclusions: [
      'All tolls covered',
      'State permit included',
      'Fuel by driver',
      'GST inclusive',
      'Meet & greet at airport',
      'Waiting time — 45 min',
    ],
    samplePricing: [
      { route: 'Ludhiana → Delhi IGI', amount: 3200 },
      { route: 'Chandigarh → Delhi IGI', amount: 2800 },
      { route: 'Amritsar → Delhi IGI', amount: 4200 },
      { route: 'Patiala → Delhi IGI', amount: 3000 },
    ],
    bestFor: ['Airport Runs', 'Family Trips', 'Long Haul'],
  },
  {
    slug: 'sedan',
    Icon: Car,
    name: 'Dzire / Etios Sedan',
    models: 'Swift Dzire / Toyota Etios',
    tagline:
      'Best value for solo travellers and small families. Reliable, economical, and city-to-airport ready.',
    category: 'economy',
    categoryLabel: 'Economy',
    pax: 4,
    luggageBags: 2,
    ac: 'Single AC',
    pricePerKmFrom: 12,
    pricePerKmTo: 14,
    airportStartFrom: 1400,
    perks: ['Fuel efficient', 'USB charging', 'Toll included', 'Verified driver'],
    inclusions: [
      'All tolls covered',
      'State permit included',
      'Fuel by driver',
      'GST inclusive',
      'Airport waiting — 30 min',
    ],
    samplePricing: [
      { route: 'Ludhiana → Delhi IGI', amount: 1800 },
      { route: 'Chandigarh → Delhi IGI', amount: 1400 },
      { route: 'Amritsar → Delhi IGI', amount: 2400 },
      { route: 'Patiala → Delhi IGI', amount: 1600 },
    ],
    bestFor: ['Solo Travel', 'Budget Trips', 'Quick Runs'],
  },
  {
    slug: 'suv',
    Icon: Car,
    name: 'Ertiga / Marazzo SUV',
    models: 'Maruti Ertiga / Mahindra Marazzo',
    tagline:
      'The perfect mid-range for families. More space, more comfort, same fixed fare pricing.',
    category: 'comfort',
    categoryLabel: 'Comfort',
    pax: 6,
    luggageBags: 3,
    ac: 'Single AC',
    pricePerKmFrom: 18,
    pricePerKmTo: 22,
    airportStartFrom: 2200,
    perks: ['3-row seating', 'USB charging', 'Toll included', 'GPS tracked'],
    inclusions: [
      'All tolls covered',
      'State permit included',
      'Fuel by driver',
      'GST inclusive',
      'Airport waiting — 30 min',
    ],
    samplePricing: [
      { route: 'Ludhiana → Delhi IGI', amount: 2400 },
      { route: 'Chandigarh → Delhi IGI', amount: 2200 },
      { route: 'Amritsar → Delhi IGI', amount: 3200 },
      { route: 'Patiala → Delhi IGI', amount: 2300 },
    ],
    bestFor: ['Family Trips', 'Groups of 6', 'Airport Runs'],
  },
  {
    slug: 'premium',
    Icon: Crown,
    name: 'Fortuner / XUV700',
    models: 'Toyota Fortuner / Mahindra XUV700',
    tagline:
      'Travel in pure luxury. For executives, events, and moments when only the best will do.',
    category: 'luxury',
    categoryLabel: 'Luxury',
    tag: 'Premium',
    pax: 6,
    luggageBags: 4,
    ac: 'Dual-zone AC',
    pricePerKmFrom: 28,
    pricePerKmTo: 35,
    airportStartFrom: 4200,
    perks: ['Leather seats', 'Wifi available', 'USB charging', 'Toll included'],
    inclusions: [
      'All tolls covered',
      'State permit included',
      'Fuel by driver',
      'GST inclusive',
      'Meet & greet at airport',
      'Waiting time — 60 min',
    ],
    samplePricing: [
      { route: 'Ludhiana → Delhi IGI', amount: 4800 },
      { route: 'Chandigarh → Delhi IGI', amount: 4200 },
      { route: 'Amritsar → Delhi IGI', amount: 6200 },
      { route: 'Patiala → Delhi IGI', amount: 4500 },
    ],
    bestFor: ['Corporate Travel', 'Luxury Events', 'Executive Transfers'],
  },
  {
    slug: 'tempo',
    Icon: Truck,
    name: 'Tempo Traveller',
    models: 'Force Tempo Traveller 12+1 Seater',
    tagline:
      'The go-to for corporate groups, pilgrimage parties, and large family travel across North India.',
    category: 'group',
    categoryLabel: 'Group',
    pax: 12,
    luggageBags: 8,
    ac: 'Roof-mount AC',
    pricePerKmFrom: 32,
    pricePerKmTo: 38,
    airportStartFrom: 5500,
    perks: ['Push-back seats', 'Overhead luggage', 'USB charging', 'GPS tracked'],
    inclusions: [
      'All tolls covered',
      'State permit included',
      'Fuel by driver',
      'GST inclusive',
      'Airport waiting — 45 min',
    ],
    samplePricing: [
      { route: 'Ludhiana → Delhi IGI', amount: 5800 },
      { route: 'Chandigarh → Delhi IGI', amount: 5500 },
      { route: 'Amritsar → Delhi IGI', amount: 7800 },
      { route: 'Patiala → Delhi IGI', amount: 5600 },
    ],
    bestFor: ['Corporate Groups', 'Pilgrimages', 'Family Reunions'],
  },
  {
    slug: 'minibus',
    Icon: Bus,
    name: 'Mini Bus 20-Seater',
    models: 'Tata Winger / Eicher 20-Seater',
    tagline:
      'Perfect for large gatherings, wedding parties, and school or college events across Punjab.',
    category: 'group',
    categoryLabel: 'Group',
    pax: 20,
    luggageBags: 12,
    ac: 'Dual AC Units',
    pricePerKmFrom: 45,
    pricePerKmTo: 55,
    airportStartFrom: 8500,
    perks: ['Comfortable seating', 'Overhead storage', 'Luggage hold', 'GPS tracked'],
    inclusions: [
      'All tolls covered',
      'State permit included',
      'Fuel by driver',
      'GST inclusive',
      'Waiting time — 45 min',
    ],
    samplePricing: [
      { route: 'Ludhiana → Delhi IGI', amount: 9000 },
      { route: 'Chandigarh → Delhi IGI', amount: 8500 },
      { route: 'Amritsar → Delhi IGI', amount: 11500 },
      { route: 'Patiala → Delhi IGI', amount: 8800 },
    ],
    bestFor: ['Wedding Parties', 'School Trips', 'Corporate Events'],
  },
];

export const FEATURED_VEHICLE = VEHICLES.find((v) => v.featured)!;
export const NON_FEATURED_VEHICLES = VEHICLES.filter((v) => !v.featured);

// ── Tabs ──────────────────────────────────────────────────────────────────────

export const CATEGORY_TABS = [
  { key: 'all' as const, label: 'All Vehicles', count: 6 },
  { key: 'economy' as const, label: 'Economy', count: 1 },
  { key: 'comfort' as const, label: 'Comfort', count: 3 },
  { key: 'luxury' as const, label: 'Luxury', count: 1 },
  { key: 'group' as const, label: 'Group', count: 2 },
];

export type TabKey = (typeof CATEGORY_TABS)[number]['key'];

// ── Fleet Stats ───────────────────────────────────────────────────────────────

export const FLEET_STATS = [
  { num: '6', label: 'Vehicle Types', sub: 'Economy to luxury' },
  { num: '4', label: 'Airport Routes', sub: 'PB → Delhi direct' },
  { num: '100%', label: 'AC Fleet', sub: 'All-year comfort' },
  { num: 'GPS', label: 'Live Tracked', sub: 'Real-time location' },
  { num: '48+', label: 'City Routes', sub: 'Across North India' },
];

// ── Comparison Table ──────────────────────────────────────────────────────────

export const COMPARE_ROWS: CompareRow[] = [
  {
    feature: 'Passengers',
    sedan: '1–4',
    suv: '1–6',
    innova: '1–7',
    premium: '1–6',
    tempo: '1–12',
    minibus: '1–20',
  },
  {
    feature: 'Luggage Bags',
    sedan: '2 bags',
    suv: '3 bags',
    innova: '4 bags',
    premium: '4 bags',
    tempo: '8 bags',
    minibus: '12 bags',
  },
  {
    feature: 'AC Type',
    sedan: 'Single',
    suv: 'Single',
    innova: 'Dual-zone',
    premium: 'Dual-zone',
    tempo: 'Roof-mount',
    minibus: 'Dual units',
  },
  {
    feature: 'GPS Tracking',
    sedan: true,
    suv: true,
    innova: true,
    premium: true,
    tempo: true,
    minibus: true,
  },
  {
    feature: 'USB Charging',
    sedan: true,
    suv: true,
    innova: true,
    premium: true,
    tempo: true,
    minibus: true,
  },
  {
    feature: 'Wifi',
    sedan: false,
    suv: false,
    innova: false,
    premium: true,
    tempo: false,
    minibus: false,
  },
  {
    feature: 'Tolls Included',
    sedan: true,
    suv: true,
    innova: true,
    premium: true,
    tempo: true,
    minibus: true,
  },
  {
    feature: 'Meet & Greet',
    sedan: false,
    suv: false,
    innova: true,
    premium: true,
    tempo: false,
    minibus: false,
  },
  {
    feature: 'Starting ₹/km',
    sedan: '₹12',
    suv: '₹18',
    innova: '₹22',
    premium: '₹28',
    tempo: '₹32',
    minibus: '₹45',
  },
];

// ── Use Cases ─────────────────────────────────────────────────────────────────

export const USE_CASES: UseCaseDef[] = [
  {
    Icon: Zap,
    title: 'Solo Airport Sprint',
    desc: 'Early flight? Late arrival? 24/7 airport cabs from any Punjab city to Delhi, Amritsar, or Chandigarh airports.',
    vehicles: ['Dzire Sedan', 'Ertiga SUV'],
  },
  {
    Icon: Users,
    title: 'Family Trip',
    desc: 'Travelling with kids, elderly parents, or heavy luggage? Our SUVs and Innova Crystas are built for comfortable family travel.',
    vehicles: ['Ertiga SUV', 'Innova Crysta'],
  },
  {
    Icon: Crown,
    title: 'Corporate & Executive',
    desc: 'Impress clients or arrive fresh. Our luxury fleet includes leather seats, Wifi, and professional chauffeurs.',
    vehicles: ['Fortuner', 'XUV700', 'Innova Crysta'],
  },
  {
    Icon: Car,
    title: 'Pilgrimage / Yatra',
    desc: 'Heading to Vaishno Devi, Amritsar, or Haridwar? Tempo Travellers are the preferred choice for yatra groups.',
    vehicles: ['Tempo Traveller', 'Mini Bus'],
  },
  {
    Icon: Bus,
    title: 'Wedding & Events',
    desc: 'Seamlessly transport guests between venues. Our fleet covers everything from baraat processions to reception logistics.',
    vehicles: ['Tempo Traveller', 'Mini Bus', 'Fortuner'],
  },
  {
    Icon: Truck,
    title: 'Outstation / Hill Trips',
    desc: 'Multi-day travel to Manali, Shimla, or Rajasthan? Our vehicles are cleared and well-maintained for hill station routes.',
    vehicles: ['Innova Crysta', 'Dzire Sedan', 'Fortuner'],
  },
];
