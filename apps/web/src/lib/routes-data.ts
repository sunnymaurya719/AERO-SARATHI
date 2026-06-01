import type { LucideIcon } from 'lucide-react';
import { Plane, Building2, MapPin, Mountain } from 'lucide-react';

export type RouteType = 'airport' | 'intercity' | 'local' | 'outstation';

export interface RoutePricing {
  sedan: number;
  suv: number;
  premium: number;
  tempo: number;
}

export interface RouteStop {
  name: string;
  desc: string;
  kind: 'start' | 'mid' | 'end';
}

export interface RouteTag {
  label: string;
  tone: 'airport' | 'intercity' | 'popular' | 'local' | 'ac' | 'new';
}

export interface RouteDef {
  id: string;
  type: RouteType;
  fromCity: string;
  fromState: string;
  toCity: string;
  toState: string;
  distanceKm: number;
  durationLabel: string;
  priceFrom: number;
  pricing: RoutePricing;
  tags: RouteTag[];
  vehicles: string[];
  stops: RouteStop[];
  featured?: boolean;
}

export const ROUTE_TYPE_META: Record<RouteType, { label: string; icon: LucideIcon }> = {
  airport: { label: 'Airport', icon: Plane },
  intercity: { label: 'Intercity', icon: Building2 },
  local: { label: 'Local', icon: MapPin },
  outstation: { label: 'Outstation', icon: Mountain },
};

export const DEPARTURE_CITIES = [
  'Ludhiana',
  'Chandigarh',
  'Amritsar',
  'Patiala',
  'Jalandhar',
  'Mohali',
  'Bathinda',
];

export const ROUTES: RouteDef[] = [
  {
    id: 'chandigarh-delhi',
    type: 'airport',
    fromCity: 'Chandigarh',
    fromState: 'Punjab',
    toCity: 'Delhi IGI Airport',
    toState: 'Terminal 3',
    distanceKm: 310,
    durationLabel: '~5h 00m',
    priceFrom: 280000,
    pricing: { sedan: 280000, suv: 420000, premium: 600000, tempo: 850000 },
    tags: [
      { label: 'Airport', tone: 'airport' },
      { label: 'Most Booked', tone: 'popular' },
      { label: 'AC', tone: 'ac' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium', 'Tempo'],
    featured: true,
    stops: [
      { name: 'Chandigarh', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Zirakpur', desc: 'Highway entry · NH-44', kind: 'mid' },
      { name: 'Karnal / Murthal', desc: 'Optional refreshment stop', kind: 'mid' },
      { name: 'Delhi IGI Airport – T3', desc: 'Drop at departure gate', kind: 'end' },
    ],
  },
  {
    id: 'ludhiana-delhi',
    type: 'airport',
    fromCity: 'Ludhiana',
    fromState: 'Punjab',
    toCity: 'Delhi IGI Airport',
    toState: 'Terminal 2/3',
    distanceKm: 260,
    durationLabel: '~4h 30m',
    priceFrom: 320000,
    pricing: { sedan: 320000, suv: 480000, premium: 650000, tempo: 900000 },
    tags: [
      { label: 'Airport', tone: 'airport' },
      { label: 'AC', tone: 'ac' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium', 'Tempo'],
    stops: [
      { name: 'Ludhiana', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Khanna', desc: 'Highway entry · NH-44', kind: 'mid' },
      { name: 'Delhi IGI Airport – T2/T3', desc: 'Drop at departure gate', kind: 'end' },
    ],
  },
  {
    id: 'amritsar-delhi',
    type: 'airport',
    fromCity: 'Amritsar',
    fromState: 'Punjab',
    toCity: 'Delhi IGI Airport',
    toState: 'All Terminals',
    distanceKm: 450,
    durationLabel: '~6h 30m',
    priceFrom: 520000,
    pricing: { sedan: 520000, suv: 750000, premium: 950000, tempo: 1200000 },
    tags: [
      { label: 'Airport', tone: 'airport' },
      { label: 'Long Haul', tone: 'intercity' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium', 'Tempo'],
    stops: [
      { name: 'Amritsar', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Jalandhar', desc: 'Highway · NH-44', kind: 'mid' },
      { name: 'Ludhiana', desc: 'Optional refreshment stop', kind: 'mid' },
      { name: 'Delhi IGI Airport', desc: 'Drop at any terminal', kind: 'end' },
    ],
  },
  {
    id: 'jalandhar-delhi',
    type: 'airport',
    fromCity: 'Jalandhar',
    fromState: 'Punjab',
    toCity: 'Delhi IGI Airport',
    toState: 'Terminal 2/3',
    distanceKm: 380,
    durationLabel: '~5h 30m',
    priceFrom: 420000,
    pricing: { sedan: 420000, suv: 600000, premium: 800000, tempo: 1050000 },
    tags: [
      { label: 'Airport', tone: 'airport' },
      { label: 'AC', tone: 'ac' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium', 'Tempo'],
    stops: [
      { name: 'Jalandhar', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Ludhiana', desc: 'Highway · NH-44', kind: 'mid' },
      { name: 'Delhi IGI Airport – T2/T3', desc: 'Drop at departure gate', kind: 'end' },
    ],
  },
  {
    id: 'patiala-chd',
    type: 'intercity',
    fromCity: 'Patiala',
    fromState: 'Punjab',
    toCity: 'Chandigarh',
    toState: 'Sector 17 / ISBT',
    distanceKm: 65,
    durationLabel: '~1h 30m',
    priceFrom: 110000,
    pricing: { sedan: 110000, suv: 160000, premium: 220000, tempo: 280000 },
    tags: [
      { label: 'Intercity', tone: 'intercity' },
      { label: 'AC', tone: 'ac' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium'],
    stops: [
      { name: 'Patiala', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Rajpura', desc: 'Highway junction', kind: 'mid' },
      { name: 'Chandigarh', desc: 'Sector 17 / ISBT / your destination', kind: 'end' },
    ],
  },
  {
    id: 'ludhiana-amritsar',
    type: 'intercity',
    fromCity: 'Ludhiana',
    fromState: 'Punjab',
    toCity: 'Amritsar',
    toState: 'Golden Temple',
    distanceKm: 140,
    durationLabel: '~2h 30m',
    priceFrom: 160000,
    pricing: { sedan: 160000, suv: 240000, premium: 320000, tempo: 400000 },
    tags: [
      { label: 'Intercity', tone: 'intercity' },
      { label: 'Popular', tone: 'popular' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium', 'Tempo'],
    stops: [
      { name: 'Ludhiana', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Jalandhar', desc: 'Highway · NH-44', kind: 'mid' },
      { name: 'Amritsar', desc: 'Golden Temple / SGRD Airport / your destination', kind: 'end' },
    ],
  },
  {
    id: 'chandigarh-ambala',
    type: 'intercity',
    fromCity: 'Chandigarh',
    fromState: 'Punjab',
    toCity: 'Ambala',
    toState: 'Cantt / City',
    distanceKm: 80,
    durationLabel: '~1h 30m',
    priceFrom: 120000,
    pricing: { sedan: 120000, suv: 180000, premium: 240000, tempo: 300000 },
    tags: [
      { label: 'Intercity', tone: 'intercity' },
      { label: 'New', tone: 'new' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium'],
    stops: [
      { name: 'Chandigarh', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Zirakpur', desc: 'Highway entry', kind: 'mid' },
      { name: 'Ambala', desc: 'Cantt / City', kind: 'end' },
    ],
  },
  {
    id: 'bathinda-chd',
    type: 'intercity',
    fromCity: 'Bathinda',
    fromState: 'Punjab',
    toCity: 'Chandigarh',
    toState: 'Sector 17',
    distanceKm: 220,
    durationLabel: '~3h 30m',
    priceFrom: 280000,
    pricing: { sedan: 280000, suv: 380000, premium: 500000, tempo: 650000 },
    tags: [
      { label: 'Intercity', tone: 'intercity' },
      { label: 'AC', tone: 'ac' },
    ],
    vehicles: ['Sedan', 'SUV', 'Premium', 'Tempo'],
    stops: [
      { name: 'Bathinda', desc: 'Pickup from your doorstep', kind: 'start' },
      { name: 'Barnala', desc: 'Highway junction', kind: 'mid' },
      { name: 'Chandigarh', desc: 'Sector 17 / your destination', kind: 'end' },
    ],
  },
];

export const POPULAR_CITIES = [
  { name: 'Ludhiana', routes: 14 },
  { name: 'Chandigarh', routes: 18 },
  { name: 'Amritsar', routes: 12 },
  { name: 'Patiala', routes: 8 },
  { name: 'Jalandhar', routes: 10 },
  { name: 'Mohali', routes: 9 },
];

export const ROUTE_INCLUSIONS = [
  'Toll charges',
  'Driver allowance',
  'Fuel cost',
  'AC vehicle',
  'Pickup from home',
  'Live GPS tracking',
  'SMS confirmation',
  '24/7 support',
];
