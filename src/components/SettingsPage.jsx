import { useState } from 'react';
import { formatCurrency } from '../data/distributors.js';

const DEFAULTS = {
  wholesale: false,
  markup: { type: 'flat', value: 10 },
};

const MARKUP_TYPES = [
  { id: 'flat', label: 'Flat rate ($ per item)' },
  { id: 'percent', label: 'Percent of purchase cost (%)' },
];

export default function SettingsPage({ pricingConfig, setPricingConfig }) {
  const [saved, setSaved] = useState(false);
  const cfg = { ...DEFAULTS, ...(pricingConfig || {}) };
  cfg.markup = { ...DEFAULTS.markup, ...((cfg.markup) || {}) };

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const pc = 104.50; // example purchase cost (wholesale $100 + $4.50 env fee)
  const markupExample = cfg.markup.type === 'percent'
    ? pc * (parseFloat(cfg.markup.value) || 0) / 100
    : (parseFloat(cfg.markup.value) || 0);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Settings</h2>
        <p className="text-sm text-muted">Pricing mode and markup settings. Purchase prices (wholesale + env fee) are never changed by these settings.</p>
      </div>

      {/* Markup settings */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Markup (Retail)</h3>
        <p className="text-xs text-muted mb-3">
          The markup added to the purchase cost on computed prices. Applies to tires (wheels/parts stay at $0 markup unless a per-item override is set on the item card).
        </p>
        <div className="flex items-center gap-2">
          <select
            className="input select w-64"
            value={cfg.markup.type}
            onChange={(e) => { setPricingConfig({ ...cfg, markup: { ...cfg.markup, type: e.target.value } }); flashSaved(); }}
          >
            {MARKUP_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="flex items-center gap-1">
            {cfg.markup.type === 'percent' && <span className="text-sm font-medium">+% of cost</span>}
            {cfg.markup.type === 'flat' && <span className="text-sm font-medium">+$</span>}
            <input
              type="number"
              step="0.01"
              className="input w-24"
              value={cfg.markup.value ?? ''}
              onChange={(e) => { setPricingConfig({ ...cfg, markup: { ...cfg.markup, value: parseFloat(e.target.value) || 0 } }); flashSaved(); }}
            />
          </div>
        </div>
        <p className="text-xs mt-2 text-muted">
          Example: an item with a purchase cost of {formatCurrency(pc)} becomes{' '}
          <span className="font-semibold">{formatCurrency(pc + markupExample)}</span>
        </p>
        <p className="text-xs mt-1 text-muted">
          In B2B mode the markup is halved ({formatCurrency(markupExample / 2)}), so the same item becomes{' '}
          <span className="font-semibold">{formatCurrency(pc + markupExample / 2)}</span>.
        </p>
        <p className="text-xs mt-1 text-muted">
          A per-item markup override on an item card always wins over this setting.
        </p>
      </div>

      {/* Pricing mode */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Pricing Mode</h3>
        <p className="text-xs text-muted mb-3">
          Wholesale (B2B) mode halves the markup for business pricing — the same toggle also lives on the Search &amp; Quote page. Purchase prices are unaffected.
        </p>
        <div className="flex gap-3">
          <button
            className={`btn ${!cfg.wholesale ? 'btn-primary' : ''}`}
            onClick={() => { setPricingConfig({ ...cfg, wholesale: false }); flashSaved(); }}
          >
            Retail
          </button>
          <button
            className={`btn ${cfg.wholesale ? 'btn-primary' : ''}`}
            onClick={() => { setPricingConfig({ ...cfg, wholesale: true }); flashSaved(); }}
            title="Halve the markup for B2B pricing"
          >
            Wholesale (B2B) — markup ÷ 2
          </button>
        </div>
      </div>

      {saved && <p className="text-success text-sm font-medium">✓ Saved — settings apply instantly</p>}
    </div>
  );
}
