-- Some Trainer prints come from the card source with the pictured character tacked on,
-- e.g. "Boss's Orders (Giovanni)" or "Professor's Research (Professor Oak)". That tag was ending up
-- in the reprint-matching key, so those prints never matched their legal reprints and showed as
-- not Standard legal. Rekey them by the real card name and recompute legality.
-- (catalog-sync now drops the tag for new rows too.)
update public.cards c
set sig = (case when c.category = 'Energy' then 'E|' else 'T|' end)
          || lower(replace(replace(regexp_replace(c.name, '\s*\([^)]*\)\s*$', ''), '’', ''''), '‘', ''''))
where c.category <> 'Pokemon'
  and c.name ~ '\([^)]*\)\s*$';

-- normName also folds é to e; apply the same so the keys line up exactly.
update public.cards c
set sig = translate(sig, 'éÉ', 'ee')
where c.category <> 'Pokemon' and sig ~ '[éÉ]';

select public.recompute_legality();
