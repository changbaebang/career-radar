import { z } from "zod";

export const CareerRadarStatusSchema = z.object({
  name: z.literal("Career Radar"),
  milestone: z.literal("Milestone 0"),
  state: z.literal("ready"),
  message: z.string().min(1),
  checkedAt: z.string().datetime(),
  capabilities: z.array(z.string().min(1)).min(1),
});

export type CareerRadarStatus = z.infer<typeof CareerRadarStatusSchema>;
