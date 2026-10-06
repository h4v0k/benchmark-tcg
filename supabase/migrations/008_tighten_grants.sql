-- Security advisor follow-ups.
alter function public.norm_name(text) set search_path = public;
revoke execute on function public.set_featured(uuid, boolean) from public, anon;
grant execute on function public.set_featured(uuid, boolean) to authenticated;
-- Catalog reads don't need elevated rights.
alter function public.search_cards(text, text, text, int) security invoker;
alter function public.resolve_decklist(jsonb, text) security invoker;
