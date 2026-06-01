import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Place, QuoteResponse, VehicleCategory, AuthUser } from '@aero/types';

interface BookingState {
  pickup: Place | null;
  drop: Place | null;
  scheduledAt: string | null;
  quote: QuoteResponse | null;
  selectedCategory: VehicleCategory | null;

  accessToken: string | null;
  user: AuthUser | null;

  setTrip: (pickup: Place, drop: Place, scheduledAt: string) => void;
  setQuote: (quote: QuoteResponse) => void;
  selectCategory: (category: VehicleCategory) => void;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  reset: () => void;
}

export const useBookingStore = create<BookingState>()(
  persist(
    (set) => ({
      pickup: null,
      drop: null,
      scheduledAt: null,
      quote: null,
      selectedCategory: null,
      accessToken: null,
      user: null,

      setTrip: (pickup, drop, scheduledAt) => set({ pickup, drop, scheduledAt }),
      setQuote: (quote) => set({ quote }),
      selectCategory: (selectedCategory) => set({ selectedCategory }),
      setAuth: (accessToken, user) => set({ accessToken, user }),
      clearAuth: () => set({ accessToken: null, user: null }),
      reset: () => set({ pickup: null, drop: null, scheduledAt: null, quote: null, selectedCategory: null }),
    }),
    {
      name: 'aero-booking',
      partialize: (s) => ({ accessToken: s.accessToken, user: s.user, quote: s.quote, selectedCategory: s.selectedCategory, pickup: s.pickup, drop: s.drop, scheduledAt: s.scheduledAt }),
    },
  ),
);
