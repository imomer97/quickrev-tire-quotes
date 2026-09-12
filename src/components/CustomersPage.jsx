import { useState, useMemo, useEffect } from 'react';
import { Users, Mail, FileText, ChevronDown, RefreshCw, NotebookPen, FilePlus2, Car, MapPin, Phone, CalendarClock } from 'lucide-react';
import { formatCurrency } from '../data/distributors.js';

const SYNC_KEY = import.meta.env.VITE_SYNC_KEY || 'quickrev-app';

/**
 * Customers page: aggregates quote history per customer — every past quote,
 * its value and date, the running total, and the last contact. Each customer
 * has editable notes (conversations, vehicle details), may carry Calendly
 * details (vehicle/address/phone synced by the server), and can be clicked
 * to preload a new quote.
 */
export default function CustomersPage({ refreshQuoteHistory, quotes, onQuoteForCustomer }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [customerRecords, setCustomerRecords] = useState({});
  const [notesDraft, setNotesDraft] = useState({});
  const [notesSaved, setNotesSaved] = useState(null);
  const [calendlyBusy, setCalendlyBusy] = useState(false);
  const [calendlyMsg, setCalendlyMsg] = useState(null);

  useEffect(() => { if (refreshQuoteHistory) refreshQuoteHistory(); }, [refreshQuoteHistory]);

  // Load the per-customer records (notes + Calendly details).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/customers', { headers: { 'x-sync-key': SYNC_KEY } });
        const j = await r.json();
        if (j && j.success) setCustomerRecords(j.customers || {});
      } catch { /* offline — records simply empty */ }
    })();
  }, []);

  const saveNotes = async (key, c) => {
    try {
      const r = await fetch(`/api/customers/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-sync-key': SYNC_KEY },
        body: JSON.stringify({ name: c.name, email: c.email, notes: notesDraft[key] ?? c.notes ?? '' }),
      });
      const j = await r.json();
      if (j && j.success) {
        setCustomerRecords(m => ({ ...m, [key]: j.customer }));
        setNotesSaved(key);
        setTimeout(() => setNotesSaved(null), 2000);
      } else {
        setNotesSaved('error');
        setTimeout(() => setNotesSaved(null), 3000);
      }
    } catch {
      setNotesSaved('error');
      setTimeout(() => setNotesSaved(null), 3000);
    }
  };

  const runCalendlySync = async () => {
    setCalendlyBusy(true);
    setCalendlyMsg(null);
    try {
      const r = await fetch('/api/calendly-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-key': SYNC_KEY },
        body: '{}',
      });
      const j = await r.json();
      if (j && j.success) {
        setCalendlyMsg(`✓ Synced ${j.invitees} booking(s) — ${j.customersUpdated} customer record(s) updated.`);
        const rr = await fetch('/api/customers', { headers: { 'x-sync-key': SYNC_KEY } });
        const jj = await rr.json();
        if (jj && jj.success) setCustomerRecords(jj.customers || {});
      } else {
        setCalendlyMsg(j && j.error ? `⚠ ${j.error}` : '⚠ Calendly sync failed.');
      }
    } catch (e) {
      setCalendlyMsg(`⚠ ${e.message}`);
    } finally {
      setCalendlyBusy(false);
    }
  };

  const customers = useMemo(() => {
    const byKey = new Map();
    for (const q of (quotes || [])) {
      const name = (q.customerName || '').trim();
      const email = q.emailStatus && q.emailStatus.to ? q.emailStatus.to.trim() : '';
      const key = (email || name || 'unnamed').toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, {
          key, name: name || (email ? email.split('@')[0] : 'Unnamed customer'),
          email, quotes: [], lastContact: null, lastEmail: null,
        });
      }
      const c = byKey.get(key);
      c.quotes.push(q);
      if (name && c.name === 'Unnamed customer') c.name = name;
      if (email && !c.email) c.email = email;
      const touched = [q.createdAt, q.emailStatus && q.emailStatus.at].filter(Boolean);
      for (const t of touched) {
        if (!c.lastContact || t > c.lastContact) c.lastContact = t;
        if (t === (q.emailStatus && q.emailStatus.at) && q.emailStatus.status === 'sent') {
          if (!c.lastEmail || t > c.lastEmail) c.lastEmail = t;
        }
      }
    }
    // Merge Calendly-only customers (bookings without quotes yet).
    for (const [key, rec] of Object.entries(customerRecords)) {
      if (!byKey.has(key) && (rec.name || rec.email)) {
        byKey.set(key, { key, name: rec.name || (rec.email ? rec.email.split('@')[0] : 'Customer'), email: rec.email || '', quotes: [], lastContact: rec.calendlyEventTime || rec.updatedAt || null, lastEmail: null });
      }
    }
    const list = [...byKey.values()].map(c => {
      const rec = customerRecords[c.key] || {};
      return {
        ...c,
        ...rec,
        quotes: c.quotes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
        quoteCount: c.quotes.length,
        totalValue: c.quotes.reduce((s, q) => s + (q.total || 0), 0),
        lastContact: [c.lastContact, rec.calendlyEventTime].filter(Boolean).sort().pop() || null,
      };
    });
    // Most recently contacted first.
    return list.sort((a, b) => (b.lastContact || '').localeCompare(a.lastContact || ''));
  }, [quotes, customerRecords]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(s) || (c.email && c.email.toLowerCase().includes(s))
    );
  }, [customers, search]);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const startQuote = (c) => {
    if (!onQuoteForCustomer) return;
    // Try to reuse the postal code from the customer's most recent quote.
    const lastQuote = c.quotes && c.quotes.find(q => q.options && q.options.postalCode);
    onQuoteForCustomer({
      customerName: c.name === 'Unnamed customer' ? '' : c.name,
      email: c.email || '',
      vehicle: c.vehicle || '',
      vehicleType: c.vehicleType || '',
      tireSize: c.tireSize || (lastQuote && lastQuote.options.tireSize) || '',
      postalCode: c.address || (lastQuote && lastQuote.options.postalCode) || '',
      notes: c.notes || '',
    });
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" />
          Customers {customers.length > 0 && <span className="badge badge-blue">{customers.length}</span>}
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="input w-56"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            onClick={runCalendlySync}
            disabled={calendlyBusy}
            title="Pull customer vehicles, addresses, and phone numbers from Calendly bookings"
          >
            <RefreshCw className={`w-4 h-4 ${calendlyBusy ? 'animate-spin' : ''}`} />
            {calendlyBusy ? 'Syncing…' : 'Calendly sync'}
          </button>
        </div>
      </div>

      {calendlyMsg && (
        <p className={`text-sm mb-3 ${calendlyMsg.startsWith('✓') ? 'text-success' : 'text-warning'}`}>{calendlyMsg}</p>
      )}

      <p className="text-xs text-muted mb-3">
        Every quote generated (with a customer name or emailed address) appears here — shared across all devices.
        Click a customer to start a new quote preloaded with their details; use Calendly sync to pull vehicle and address info from bookings.
      </p>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          {customers.length === 0
            ? 'No customers yet — add a customer name, email a quote, or run a Calendly sync.'
            : 'No customers match your search.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((c) => (
            <li key={c.key} className="card p-0 overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                onClick={() => setExpanded(expanded === c.key ? null : c.key)}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted truncate">
                    {c.email ? `${c.email} · ` : ''}
                    {c.quoteCount > 0 ? `${c.quoteCount} quote${c.quoteCount === 1 ? '' : 's'} · total value ${formatCurrency(c.totalValue)}` : 'No quotes yet'}
                    {c.notes ? ' · 📝 notes' : ''}
                    {(c.vehicle || c.calendlyEvent) ? ' · 📅 Calendly' : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium">Last contact</p>
                  <p className="text-xs text-muted">{c.lastContact ? fmtDay(c.lastContact) : '—'}</p>
                </div>
                {c.quoteCount > 0 && (
                  <span
                    className="btn btn-sm btn-ghost shrink-0"
                    onClick={(e) => { e.stopPropagation(); startQuote(c); }}
                    title="Start a new quote preloaded with this customer's name, email, vehicle, and postal code"
                  >
                    <FilePlus2 className="w-4 h-4" />
                    Quote
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${expanded === c.key ? 'rotate-180' : ''}`} />
              </button>
              {expanded === c.key && (
                <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
                  {/* Calendly-derived details */}
                  {(c.vehicle || c.tireSize || c.address || c.phone || c.calendlyEvent) && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3">
                      {c.vehicle && <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5 text-muted" />{c.vehicle}</span>}
                      {c.tireSize && <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-muted" />{c.tireSize}</span>}
                      {c.address && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-muted" />{c.address}</span>}
                      {c.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-muted" />{c.phone}</span>}
                      {c.calendlyEvent && <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5 text-muted" />{c.calendlyEvent} · {fmtDay(c.calendlyEventTime)}</span>}
                    </div>
                  )}
                  {/* Per-customer notes */}
                  <div className="mb-3">
                    <label className="text-xs font-semibold text-muted uppercase flex items-center gap-1 mb-1">
                      <NotebookPen className="w-3.5 h-3.5" />
                      Notes — conversations, vehicle details
                    </label>
                    <textarea
                      className="input w-full text-sm"
                      rows={3}
                      placeholder="e.g. Discussed winter tire options on the phone; second vehicle is a 2019 Civic; prefers morning installs…"
                      value={notesDraft[c.key] ?? c.notes ?? ''}
                      onChange={(e) => setNotesDraft(d => ({ ...d, [c.key]: e.target.value }))}
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <button className="btn btn-sm btn-primary" onClick={() => saveNotes(c.key, c)} disabled={(notesDraft[c.key] ?? c.notes ?? '') === (c.notes ?? '')}>
                        Save notes
                      </button>
                      {notesSaved === c.key && <span className="text-xs text-success">✓ Saved</span>}
                      {notesSaved === 'error' && <span className="text-xs text-danger">✗ Could not save — check connection</span>}
                    </div>
                  </div>
                  {/* Quote history */}
                  <ul className="flex flex-col gap-2">
                    {c.quotes.map((q) => (
                      <li key={q.id} className="flex items-center gap-3 text-sm">
                        <FileText className="w-4 h-4 text-muted shrink-0" />
                        <span className="text-muted shrink-0">{fmtDate(q.createdAt)}</span>
                        <span className="flex-1 min-w-0 truncate">
                          {q.itemCount ?? (q.tires ? q.tires.length : 0)} item(s)
                          {q.options && q.options.postalCode ? ` · ${q.options.postalCode}` : ''}
                        </span>
                        <span className="font-medium shrink-0">{q.total ? formatCurrency(q.total) : '—'}</span>
                        {q.emailStatus && (
                          <span
                            className={`text-xs shrink-0 ${q.emailStatus.status === 'sent' ? 'text-success' : q.emailStatus.status === 'failed' ? 'text-danger' : 'text-warning'}`}
                            title={q.emailStatus.to}
                          >
                            <Mail className="w-3.5 h-3.5 inline" />
                            {q.emailStatus.status === 'sent' ? ' ✓ sent' : q.emailStatus.status === 'failed' ? ' ✗ failed' : ' ⚠ draft'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {c.lastEmail && (
                    <p className="text-xs text-muted mt-2">Last quote emailed: {fmtDay(c.lastEmail)}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
