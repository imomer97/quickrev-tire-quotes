import { useState, useEffect, useCallback } from 'react';

const HISTORY_KEY = 'quickrev_quote_history';
const TEMPLATE_KEY = 'quickrev_email_template';
const SYNC_KEY = import.meta.env.VITE_SYNC_KEY || 'quickrev-app';

export const DEFAULT_EMAIL_TEMPLATE = `Hello {{customer}},

Thank you for your interest in QuickRev. Please find attached your quote ({{filename}}) for {{items}} item(s){{totalSuffix}}.

Any questions, just reply to this email — we're happy to help.

— QuickRev
quickrev.ca`;

function loadLocal() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch { return []; }
}

/**
 * Quote history: every generated quote is snapshotted (items, totals, PDF
 * options, customer) so it can be reopened, duplicated, or re-emailed later.
 * Server-backed (shared across devices) with a localStorage mirror so the
 * panel still works offline or before the first server round-trip.
 */
export function useQuoteHistory() {
  const [quotes, setQuotes] = useState(loadLocal);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/quote-history', { headers: { 'x-sync-key': SYNC_KEY } });
      const d = await r.json();
      if (d.success && Array.isArray(d.quotes)) {
        setQuotes(d.quotes);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(d.quotes)); } catch { /* ignore */ }
      }
    } catch { /* offline — keep local mirror */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveQuote = useCallback(async (quote) => {
    // Optimistic local update first so the UI is instant.
    setQuotes(prev => {
      const next = prev.filter(q => q.id !== quote.id);
      next.unshift(quote);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 200))); } catch { /* ignore */ }
      return next.slice(0, 200);
    });
    try {
      const r = await fetch('/api/quote-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-key': SYNC_KEY },
        body: JSON.stringify(quote),
      });
      const d = await r.json();
      if (d.success && Array.isArray(d.quotes)) {
        setQuotes(d.quotes);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(d.quotes)); } catch { /* ignore */ }
        return true;
      }
    } catch { /* offline — local copy kept */ }
    return false;
  }, []);

  const deleteQuote = useCallback(async (id) => {
    setQuotes(prev => prev.filter(q => q.id !== id));
    try { await fetch(`/api/quote-history/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-sync-key': SYNC_KEY } }); } catch { /* ignore */ }
  }, []);

  return { quotes, saveQuote, deleteQuote, refresh };
}

/** Load the user's editable email template (falls back to the default). */
export function loadEmailTemplate() {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_EMAIL_TEMPLATE;
  } catch { return DEFAULT_EMAIL_TEMPLATE; }
}

export function saveEmailTemplate(t) {
  try { localStorage.setItem(TEMPLATE_KEY, t); } catch { /* ignore */ }
}

/**
 * Render the template: replaces {{placeholders}} with quote values.
 * Supported: customer, items, total, filename, date, postal, vehicle.
 */
export function renderEmailTemplate(template, values) {
  const map = {
    customer: values.customer || 'there',
    items: String(values.items ?? 0),
    total: values.total || '',
    totalSuffix: values.total ? ` — estimated total ${values.total}` : '',
    filename: values.filename || 'QuickRev-Quote.pdf',
    date: values.date || new Date().toLocaleDateString(),
    postal: values.postal || '',
    vehicle: values.vehicle || '',
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in map ? map[key] : m));
}
