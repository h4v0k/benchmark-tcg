// Under the Cards search box: the friendly error for a bad query, "Syntax help" and "Advanced search".
import { useState } from 'react';
import { Icon } from './ui';
import { CardSearchForm } from './CardSearchForm';
import { SYNTAX_HELP, parseCardQuery } from '../lib/cardquery';

export function CardSearchTools({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const [open, setOpen] = useState<'' | 'help' | 'form'>('');
  const error = parseCardQuery(q).error;
  const toggle = (k: 'help' | 'form') => setOpen(o => (o === k ? '' : k));
  return (
    <>
      <div className="syntax-tools">
        <button type="button" className="btn small" aria-expanded={open === 'help'} onClick={() => toggle('help')}><Icon name="info" size={14} />Syntax help</button>
        <button type="button" className="btn small" aria-expanded={open === 'form'} onClick={() => toggle('form')}><Icon name="search" size={14} />Advanced search</button>
      </div>
      {error && <p className="notice bad" role="alert"><Icon name="warn" size={15} />{error}</p>}
      {open === 'help' && (
        <div className="panel syntax-help">
          <p className="muted small">Type words for a name, or add fields. Fields can be mixed: <code>t:fire hp&gt;=200 -is:ex</code>. Click an example to try it.</p>
          <table>
            <thead><tr><th>Field</th><th>Finds</th><th>Example</th></tr></thead>
            <tbody>{SYNTAX_HELP.map(r => (
              <tr key={r.field}><td><code>{r.field}</code></td><td>{r.what}</td>
                <td>{r.example.split(/ {3}/).map(ex => <button type="button" key={ex} className="link-btn" onClick={() => onSearch(ex)}><code>{ex}</code></button>)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open === 'form' && <CardSearchForm onSearch={s => { onSearch(s); }} onClear={() => onSearch('')} />}
    </>
  );
}
