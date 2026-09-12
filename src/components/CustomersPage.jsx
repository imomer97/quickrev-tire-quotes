import { useState, useMemo, useEffect } from 'react';
import { Users, Mail, FileText, ChevronDown, RefreshCw } from 'lucide-react';
import { formatCurrency } from '../data/distributors.js';

/**
 * Customers page: aggregates quote history per customer — every past quote,
 * its value and date, the running total, and the last contact (latest quote
 * or emailed date). Data comes from the shared server store, so it reflects
 * quotes generated on any device.
 */
export default function CustomersPage({ refreshQuoteHistory, quotes }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { if (refreshQuoteHistory) refreshQuoteHistory(); }, [refreshQuoteHistory]);

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
    const list = [...byKey.values()].map(c => ({
      ...c,
      quotes: c.quotes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
      quoteCount: c.quotes.length,
      totalValue: c.quotes.reduce((s, q) => s + (q.total || 0), 0),
    }));
    // Most recently contacted first.
    return list.sort((a, b) => (b.lastContact || '').localeCompare(a.lastContact || ''));
  }, [quotes]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(s) || (c.email && c.email.toLowerCase().includes(s))
    );
  }, [customers, search]);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" />
          Customers {customers.length > 0 && <span className="badge badge-blue">{customers.length}</span>}
        </h2>
        <input
          type="text"
          className="input w-64"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <p className="text-xs text-muted mb-3">
        Every quote generated (with a customer name or emailed address) appears here — shared across all devices.
      </p>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          {customers.length === 0
            ? 'No customers yet — add a customer name or email a quote and they will show up here.'
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
                    {c.quoteCount} quote{c.quoteCount === 1 ? '' : 's'} · total value {formatCurrency(c.totalValue)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-medium">Last contact</p>
                  <p className="text-xs text-muted">{c.lastContact ? fmtDay(c.lastContact) : '—'}</p>
                </div>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${expanded === c.key ? 'rotate-180' : ''}`} />
              </button>
              {expanded === c.key && (
                <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
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
