import { useMemo, useState } from 'react';
import { Package, Search, ShoppingCart } from 'lucide-react';
import {
  parseTireSize,
  formatCurrency,
  getEffectiveRetail,
} from '../data/distributors.js';

/**
 * Bundle Builder — a customer asks about a tire size (e.g. 225/50R18) and you
 * present every tire option in the catalog for that size, each bundled with a
 * set of rims (picked from the fitment DB by rim SKU) and an installation
 * rate per set. The rate is configurable in Settings (pricingConfig.bundleInstallRate).
 */

const DEFAULT_INSTALL_RATE = 50;

// Normalize a metric size for comparison: "225/50R18" → "225/50R18".
function normSize(tire) {
  const p = parseTireSize(tire && tire.size);
  return p ? `${p.width}/${p.aspect}R${p.rim}` : String((tire && tire.size) || '').trim().toUpperCase();
}

export default function BundleBuilder({ tires = [], fitments = [], pricingConfig, setPricingConfig, onAddBundles, warehouseLocations = [], distributors = [] }) {
  const [sizeInput, setSizeInput] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [category, setCategory] = useState('tire');
  const [rateDraft, setRateDraft] = useState(null); // null = use the Settings value
  const [addedMsg, setAddedMsg] = useState(null); // confirmation after adding to the quote
  // === CATALOG FILTERS ===
  const [distributorFilter, setDistributorFilter] = useState(''); // '' = all distributors
  const [warehouse, setWarehouse] = useState(''); // '' = all warehouses (stock sums)
  const [inStockOnly, setInStockOnly] = useState(false);
  const [minStock, setMinStock] = useState(4);

  const parsed = parseTireSize(sizeInput);
  const diameter = parsed ? parsed.rim : null;
  const normInput = parsed ? `${parsed.width}/${parsed.aspect}R${parsed.rim}` : '';

  const installRate = (() => {
    if (rateDraft != null && rateDraft !== '') {
      const n = parseFloat(rateDraft);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    const v = pricingConfig && pricingConfig.bundleInstallRate;
    return Number.isFinite(parseFloat(v)) ? parseFloat(v) : DEFAULT_INSTALL_RATE;
  })();

  const setInstallRate = (v) => {
    const n = parseFloat(v);
    if (setPricingConfig && Number.isFinite(n) && n >= 0) {
      setPricingConfig(c => ({ ...(c || {}), bundleInstallRate: n }));
    }
  };

  // Rim SKUs from the fitment DB that match the entered rim diameter.
  const rimOptions = useMemo(() => {
    if (!diameter) return [];
    const bySku = new Map();
    for (const f of fitments) {
      if (!f) continue;
      const rim = String(f.rimSize || f.rim || '').trim();
      if (!rim || parseInt(rim, 10) !== diameter) continue;
      const skus = [
        ...String(f.exactFitSkus || '').split(','),
        ...String(f.multiFitSkus || '').split(','),
        ...String(f.sku || '').split(','),
      ].map(s => s.trim()).filter(Boolean);
      for (const sku of skus) {
        if (!bySku.has(sku)) {
          bySku.set(sku, { sku, rimSize: rim, vehicles: new Set(), boltPattern: '', notes: new Set() });
        }
        const row = bySku.get(sku);
        const veh = [f.year, f.make, f.model, f.trim].filter(Boolean).join(' ');
        if (veh) row.vehicles.add(veh);
        if (f.boltPattern && !row.boltPattern) row.boltPattern = f.boltPattern;
        String(f.notes || '').split(';').map(n => n.trim()).filter(Boolean).forEach(n => row.notes.add(n));
      }
    }
    return [...bySku.values()]
      .map(r => ({ ...r, vehicles: [...r.vehicles].slice(0, 3), notes: [...r.notes] }))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [fitments, diameter]);

  // Stock for the current warehouse selection: a specific warehouse reads the
  // per-location inventory; "all warehouses" falls back to the summed stock.
  const stockOf = (tire) => {
    if (warehouse) {
      return ((tire.inventory || []).find(l => l.location === warehouse) || {}).quantity ?? 0;
    }
    return tire.stock || 0;
  };

  // Tire options from the catalog that match the entered size exactly
  // (normalized), filtered by category, distributor, and availability.
  const tireOptions = useMemo(() => {
    if (!normInput) return [];
    return tires
      .filter(t => t && normSize(t) === normInput)
      .filter(t => !category || (t.category || 'tire') === category)
      .filter(t => !distributorFilter || t.distributorId === distributorFilter)
      .filter(t => !inStockOnly || stockOf(t) >= minStock)
      .map(t => ({ tire: t, retail: getEffectiveRetail(t) || 0 }))
      .sort((a, b) => a.retail - b.retail);
  }, [tires, normInput, category, distributorFilter, inStockOnly, minStock, warehouse]);

  const totalMatches = useMemo(() => (
    normInput
      ? tires.filter(t => t && normSize(t) === normInput).filter(t => !category || (t.category || 'tire') === category).length
      : 0
  ), [tires, normInput, category]);

  const selectedRim = rimOptions.find(r => r.sku === selectedSku) || null;

  // Price per set of 4 tires (retail) — install rate is added on top per set.
  const setPrice = (retail) => retail * 4;

  // Build a ready-made quote line item for a bundle: tires × 4 plus the
  // installation rate in a single price (category 'service' prices itself
  // directly and skips install math on the PDF). The bundle parts are stored
  // on the item so the quote panel can edit them later (price recomputes).
  const buildBundleItem = ({ tire, retail }) => {
    const brandModel = [tire.brand, tire.model].filter(Boolean).join(' ').trim();
    const rimSku = selectedRim ? selectedRim.sku : '';
    const bolt = selectedRim && selectedRim.boltPattern ? selectedRim.boltPattern : '';
    return {
      id: `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category: 'service',
      brand: 'QuickRev',
      // Nice PDF label, e.g. "STX81257H × 225/50R18 OVATION WV-688 Bundle"
      model: `${rimSku ? `${rimSku} × ` : ''}${normInput}${brandModel ? ` ${brandModel}` : ''} Bundle`,
      // Size column on the PDF keeps only the product specs; qty lives in the
      // Qty column (bundleQty) and the install rate is a global pricing note.
      size: `${normInput}${bolt ? ` · ${bolt}` : ''}`,
      price: +(setPrice(retail) + installRate).toFixed(2),
      // Season pulls from the source tire (e.g. Winter) so the PDF shows it.
      season: tire.season || 'None',
      tier: 'service',
      stock: 1,
      includeInstall: false,
      isService: true,
      // Editable bundle fields (used by the quote line-item editor)
      isBundle: true,
      rimSku,
      tireSize: normInput,
      tireName: brandModel,
      tireUnit: +retail.toFixed(2),
      installRate: +installRate.toFixed(2),
      // The bundle covers a set of 4 — shown in the PDF's Qty column.
      bundleQty: 4,
      quoteQty: 1,
      _transient: true,
    };
  };

  const flashAdded = (n) => {
    setAddedMsg(`Added ${n} bundle${n === 1 ? '' : 's'} to the quote — open Search & Quote to generate the PDF.`);
    setTimeout(() => setAddedMsg(null), 4000);
  };

  const addOne = (entry) => {
    if (!onAddBundles) return;
    onAddBundles([buildBundleItem(entry)]);
    flashAdded(1);
  };

  const addAll = () => {
    if (!onAddBundles || tireOptions.length === 0) return;
    onAddBundles(tireOptions.map(buildBundleItem));
    flashAdded(tireOptions.length);
  };

  const label = 'text-sm font-medium mb-1 block text-primary';
  const inputCls = 'input w-full';

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Package className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold text-primary">Bundle Builder</h2>
      </div>
      <p className="text-sm text-muted mb-4">
        A customer asks about a size (e.g. <strong>225/50R18</strong>): pick a set of rims from the
        fitment database, then present every tire option for that size as a bundle with the
        installation rate per set.
      </p>

      {/* Step 1: size + rim picker */}
      <div className="card p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>Tire size</label>
          <input
            className={inputCls}
            placeholder="225/50R18"
            value={sizeInput}
            onChange={e => { setSizeInput(e.target.value); setSelectedSku(''); }}
          />
          {sizeInput && !parsed && (
            <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>Use a metric size like 225/50R18.</p>
          )}
        </div>
        <div>
          <label className={label}>Rim SKU (set of rims)</label>
          <select className={inputCls} value={selectedSku} onChange={e => setSelectedSku(e.target.value)} disabled={!rimOptions.length}>
            <option value="">{rimOptions.length ? 'Select rim SKU…' : '— enter a size first —'}</option>
            {rimOptions.map(r => (
              <option key={r.sku} value={r.sku}>{r.sku} — {r.rimSize}"{r.boltPattern ? ` · ${r.boltPattern}` : ''}</option>
            ))}
          </select>
          {selectedRim && selectedRim.vehicles.length > 0 && (
            <p className="text-xs text-muted mt-1" title={selectedRim.vehicles.join(', ')}>
              Fits: {selectedRim.vehicles.join(', ')}{selectedRim.vehicles.length >= 3 ? '…' : ''}
            </p>
          )}
        </div>
        <div>
          <label className={label}>Item category</label>
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="tire">Tires</option>
            <option value="wheel">Wheels / Rims</option>
            <option value="part">Parts</option>
            <option value="">All</option>
          </select>
        </div>
        <div>
          <label className={label}>Install rate ($ / set of 4)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={rateDraft != null ? rateDraft : (pricingConfig && pricingConfig.bundleInstallRate != null ? pricingConfig.bundleInstallRate : DEFAULT_INSTALL_RATE)}
              onChange={e => { setRateDraft(e.target.value); setInstallRate(e.target.value); }}
            />
          </div>
          <p className="text-xs text-muted mt-1">Saved in Settings (bundle install rate).</p>
        </div>
      </div>

      {/* Step 2: catalog filters (distributor, warehouse, availability) */}
      <div className="card p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>Distributor</label>
          <select className={inputCls} value={distributorFilter} onChange={e => setDistributorFilter(e.target.value)}>
            <option value="">All distributors</option>
            {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Warehouse</label>
          <select className={inputCls} value={warehouse} onChange={e => setWarehouse(e.target.value)}>
            <option value="">All warehouses (summed stock)</option>
            {warehouseLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Availability</label>
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <input type="checkbox" checked={inStockOnly} onChange={e => setInStockOnly(e.target.checked)} className="rounded" />
            <span className="text-sm">In stock only</span>
          </label>
        </div>
        <div>
          <label className={label}>Min. stock (for quote)</label>
          <input
            type="number"
            min="0"
            max="20"
            className={inputCls}
            value={minStock}
            onChange={e => setMinStock(Math.max(0, parseInt(e.target.value) || 0))}
          />
        </div>
      </div>

      {/* Bundle rows */}
      {!normInput ? (
        <div className="card p-6 text-center text-muted">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>Enter a tire size above to see bundles.</p>
        </div>
      ) : tireOptions.length === 0 ? (
        <div className="card p-6 text-center text-muted">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>
            {totalMatches > 0
              ? `All ${totalMatches} catalog item(s) for ${normInput} are hidden by the current filters — relax the distributor, warehouse, or availability filters above.`
              : `No catalog items found for ${normInput}. Sync the catalog (Import Data → Sync) or check the size.`}
          </p>
        </div>
      ) : (
        <>
        {addedMsg && <p className="text-success text-sm mb-2 font-medium">✓ {addedMsg}</p>}
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted">
            {tireOptions.length === totalMatches
              ? `${tireOptions.length} option(s) for ${normInput}`
              : `${tireOptions.length} of ${totalMatches} option(s) for ${normInput} (filtered)`}
            {warehouse ? ` · ${warehouse}` : ''}
          </span>
          <button className="btn btn-sm btn-primary" onClick={addAll} disabled={!onAddBundles}>
            <ShoppingCart className="w-4 h-4" />
            Add all to quote
          </button>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-xs uppercase text-muted">
                <th className="px-3 py-2">Bundle</th>
                <th className="px-3 py-2">Brand / Model</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2 text-right">Tire (ea)</th>
                <th className="px-3 py-2 text-right">Tires × 4</th>
                <th className="px-3 py-2 text-right">Install / set</th>
                <th className="px-3 py-2 text-right">Bundle total</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tireOptions.map(({ tire, retail }) => {
                const bundleName = `${selectedRim ? selectedRim.sku : '? SKU'} × ${normInput} ${[tire.brand, tire.model].filter(Boolean).join(' ')} Bundle`.trim();
                return (
                  <tr key={tire.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-semibold text-primary">{bundleName}</td>
                    <td className="px-3 py-2">{[tire.brand, tire.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tire.size}
                      {selectedRim && selectedRim.boltPattern ? <span className="text-muted text-xs"> · {selectedRim.boltPattern}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(retail)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(setPrice(retail))}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(installRate)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(setPrice(retail) + installRate)}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        // Color-coded, warehouse-aware stock: green healthy,
                        // amber moderate, orange low, red out.
                        const s = stockOf(tire);
                        const color = s === 0 ? '#dc2626' : s < 4 ? '#ea580c' : s <= 10 ? '#ca8a04' : '#16a34a';
                        return <span className="font-bold" style={{ color }}>{s}</span>;
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <button className="btn btn-sm btn-primary whitespace-nowrap" onClick={() => addOne({ tire, retail })} disabled={!onAddBundles} title="Add this bundle as one line item on the quote">
                        <ShoppingCart className="w-3.5 h-3.5" />
                        Add to quote
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selectedRim && selectedRim.notes.length > 0 && (
            <p className="px-3 py-2 text-xs text-muted border-t border-slate-200">
              Rim notes: {selectedRim.notes.join(' · ')}
            </p>
          )}
        </div>
        </>
      )}
    </div>
  );
}
