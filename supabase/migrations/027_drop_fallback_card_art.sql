-- Undo 026: cards must only ever show their own printing's art, never another printing's.
drop function if exists public.fallback_image(public.cards);
