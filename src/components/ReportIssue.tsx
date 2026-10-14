// "Report an issue" link for the footer: a short form that's saved and emailed to the owner.
import { useState } from 'react';
import { Icon, Modal } from './ui';
import { toast, useAuth } from '../state';
import * as api from '../lib/api';

const PAYPAL = 'https://www.paypal.com/qrcodes/p2pqrc/LJCBQSLCFHZRJ';

export function SupportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link-btn foot-report" onClick={() => setOpen(true)}><Icon name="heart" size={14} />Support Benchmark</button>
      {open && (
        <Modal title="Support Benchmark" onClose={() => setOpen(false)}>
          <p>Benchmark is free and run by one person. Donations help cover hosting and card and tournament data, and keep new features coming.</p>
          <div className="support-pay">
            <a className="btn primary big" href={PAYPAL} target="_blank" rel="noopener noreferrer"><Icon name="external" />Donate with PayPal</a>
            <figure className="support-qr"><img src="/brand/paypal-qr.png" alt="PayPal QR code" width={180} height={180} /><figcaption className="muted small">Or scan with your phone</figcaption></figure>
          </div>
          <p className="muted small">Thank you! Every bit helps.</p>
        </Modal>
      )}
    </>
  );
}

export function ReportIssueButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link-btn foot-report" onClick={() => setOpen(true)}><Icon name="warn" size={14} />Report an issue</button>
      {open && <ReportIssueModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportIssueModal({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(session?.user.email || '');
  const [website, setWebsite] = useState(''); // hidden from people; bots fill it in
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (message.trim().length < 5) { setError('Please describe what went wrong.'); return; }
    setBusy(true); setError('');
    try {
      const r: any = await api.reportIssue({ message, email: email.trim(), page: location.href, website });
      if (r?.ok === false) setError(r.error || 'Something went wrong. Please try again.');
      else { setSent(true); toast('Thanks! Your report was sent.', 'ok'); }
    } catch (e: any) { setError(e.message || 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };

  if (sent) return (
    <Modal title="Thanks for the report" onClose={onClose}>
      <p>It's on its way. {email.trim() ? "If there's a follow-up question, you'll hear back by email." : 'Add an email next time if you want a reply.'}</p>
      <div className="row-gap" style={{ marginTop: 14 }}><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );

  return (
    <Modal title="Report an issue" onClose={onClose} footer={
      <>
        <span className="muted small">We'll include this page's address and your browser type.</span>
        <div className="row-gap">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </>
    }>
      <p className="muted">Something broken, wrong or confusing? Tell us what happened.</p>
      <label className="field"><span>What went wrong?</span>
        <textarea rows={5} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)}
          placeholder="What you were doing, what you expected, and what happened instead" />
      </label>
      <label className="field"><span>Your email (optional, if you'd like a reply)</span>
        <input type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      <label className="hp-field" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
    </Modal>
  );
}
