import { z } from 'zod';

const PlaceSchema = z.object({
  address: z.string().min(1).max(300),
  lat: z.number().gte(6).lte(38), // India bbox-ish
  lng: z.number().gte(68).lte(98),
  placeId: z.string().max(300).optional().default(''),
});

export const QuoteRequestSchema = z.object({
  pickup: PlaceSchema,
  drop: PlaceSchema,
  scheduledAt: z.string().datetime(),
});

export type QuoteRequestInput = z.infer<typeof QuoteRequestSchema>;
