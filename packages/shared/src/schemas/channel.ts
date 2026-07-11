import { z } from "zod";

export const createChannelSchema = z.object({
  type: z.enum(["email", "slack", "web"]),
  name: z.string().min(1).max(120),
  config: z.record(z.unknown()).optional().default({}),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const channelResponseSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  type: z.enum(["email", "slack", "web"]),
  name: z.string(),
  config: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ChannelResponse = z.infer<typeof channelResponseSchema>;
