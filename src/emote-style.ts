import { z } from 'zod';
// Retained for opening older projects. Style presets are deferred until v2.
export const emoteStyleSchema = z.enum(['dance', 'celebration', 'meme', 'emotion', 'rest']);
export type EmoteStyle = z.infer<typeof emoteStyleSchema>;
// Ignore legacy selections as well as requests from older clients.
export function generationPrompt(prompt: string, _legacyStyle?: EmoteStyle) {
  return prompt.trim();
}
