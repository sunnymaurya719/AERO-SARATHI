import type { Place } from '@aero/types';

/**
 * Phase 1 dev preset locations (Punjab / airport / intercity). In production
 * these are replaced by Google Places autocomplete via a BFF proxy.
 */
export const PRESET_PLACES: Place[] = [
  { address: 'Chandigarh Int’l Airport (IXC)', lat: 30.6735, lng: 76.7885, placeId: 'preset-ixc' },
  { address: 'Sector 17, Chandigarh', lat: 30.7411, lng: 76.7681, placeId: 'preset-chd17' },
  { address: 'Ludhiana Bus Stand', lat: 30.912, lng: 75.8573, placeId: 'preset-ldh' },
  { address: 'Amritsar — Golden Temple', lat: 31.62, lng: 74.8765, placeId: 'preset-asr' },
  { address: 'Jalandhar City', lat: 31.326, lng: 75.5762, placeId: 'preset-jln' },
  { address: 'Patiala — Qila Mubarak', lat: 30.3398, lng: 76.3869, placeId: 'preset-pta' },
  { address: 'Mohali (SAS Nagar)', lat: 30.7046, lng: 76.7179, placeId: 'preset-mhl' },
];

export function formatINR(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paise / 100,
  );
}
