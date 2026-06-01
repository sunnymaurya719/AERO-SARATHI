import { z } from 'zod';

export const CreateBookingSchema = z.object({
  quoteId: z.string().uuid(),
  vehicleCategory: z.enum(['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY']),
  passengerName: z.string().min(1).max(120),
  passengerPhone: z.string().regex(/^\+91\d{10}$/),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
