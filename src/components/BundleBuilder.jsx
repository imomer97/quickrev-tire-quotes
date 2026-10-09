import { useMemo, useState } from 'react';
import { Package, Search, ShoppingCart, CheckSquare, Square } from 'lucide-react';
import {
  parseTireSize,
  parseWheelSize,
  formatCurrency,
  getEffectiveRetail,
  lookupRimUnitPrice,
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
  // Season filter (multi-select, matches the catalog's season values)
  const [activeSeasons, setActiveSeasons] = useState(new Set());
  // Rim price per wheel — a bundle is 4 tires + 4 rims, so the rim cost ×4
  // is part of the bundle price. Maintained here, stored on the item.
  const [rimUnit, setRimUnit] = useState('');
  // When on, adding bundles also adds one $X/set installation line. The
  // 10% QuickRev discount is internal and never mentioned on the PDF.
  const [includeInstallation, setIncludeInstallation] = useState(true);
  // Multi-select: bundle rows the user ticked for a mixed quote
  const [selectedIds, setSelectedIds] = useState(new Set());

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

  // Seasons present in the catalog for this size (drives the filter chips).
  const seasonOptions = useMemo(() => {
    const set = new Set();
    for (const t of tires) {
      if (t && (!normInput || normSize(t) === normInput) && t.season) set.add(t.season);
    }
    return [...set].sort();
  }, [tires, normInput]);

  // Tire options from the catalog that match the entered size exactly
  // (normalized), filtered by category, distributor, season, and availability.
  const tireOptions = useMemo(() => {
    if (!normInput) return [];
    return tires
      .filter(t => t && normSize(t) === normInput)
      .filter(t => !category || (t.category || 'tire') === category)
      .filter(t => !distributorFilter || t.distributorId === distributorFilter)
      .filter(t => activeSeasons.size === 0 || activeSeasons.has(t.season || 'None'))
      .filter(t => !inStockOnly || stockOf(t) >= minStock)
      .map(t => ({ tire: t, retail: getEffectiveRetail(t) || 0 }))
      .sort((a, b) => a.retail - b.retail);
  }, [tires, normInput, category, distributorFilter, activeSeasons, inStockOnly, minStock, warehouse]);

  const totalMatches = useMemo(() => (
    normInput
      ? tires.filter(t => t && normSize(t) === normInput).filter(t => !category || (t.category || 'tire') === category).length
      : 0
  ), [tires, normInput, category]);

  const selectedRim = rimOptions.find(r => r.sku === selectedSku) || null;

  // Rim price comes straight from the catalog: the wheel item whose SKU
  // matches the selected rim SKU. The manual input is ONLY for rims that
  // aren't in the catalog — it overrides the lookup when filled.
  const catalogRimPrice = useMemo(
    () => lookupRimUnitPrice(tires, selectedSku),
    [tires, selectedSku]
  );

  const rimUnitNum = Math.max(0, parseFloat(rimUnit) || catalogRimPrice || 0);

  // Rim specs from the catalog: find the wheel item whose SKU/model matches
  // the selected rim SKU and pull diameter×width, bolt pattern, and centre
  // bore (CB) from its size string (e.g. "18X8 5-112 72.6").
  const rimSpec = useMemo(() => {
    if (!selectedSku) return '';
    const wheel = tires.find(t => t && t.category === 'wheel' && (
      String(t.sku || '').toUpperCase() === selectedSku.toUpperCase()
      || String(t.model || '').toUpperCase().includes(selectedSku.toUpperCase())
    ));
    if (!wheel) return '';
    const s = String(wheel.size || '');
    const w = parseWheelSize(s);
    const parts = [];
    if (w && w.diameter != null) {
      parts.push(w.width != null ? `${w.diameter}x${w.width}` : `${w.diameter}`);
    }
    if (w && w.boltPattern) parts.push(String(w.boltPattern).toUpperCase());
    // Centre bore: the standalone decimal number in the size string (e.g. 72.6)
    const cb = s.match(/\b(\d{2}\.\d+)\b/);
    if (cb) parts.push(`CB${cb[1]}`);
    return parts.join(' · ');
  }, [tires, selectedSku]);

  // Build a ready-made quote line item for a bundle: 4 tires + 4 rims at a
  // per-bundle price (Qty 1 on the PDF). Installation is a separate line.
  const buildBundleItem = ({ tire, retail }) => {
    const brandModel = [tire.brand, tire.model].filter(Boolean).join(' ').trim();
    const rimSku = selectedRim ? selectedRim.sku : '';
    const bolt = selectedRim && selectedRim.boltPattern ? selectedRim.boltPattern : '';
    // A bundle = 4 tires + 4 rims. Its price is PER BUNDLE (Qty 1 on the PDF):
    // (tire × 4) + (rim × 4). Installation is a SEPARATE $50/set line added
    // when the user has Include Installation on.
    const bundlePrice = +(retail * 4 + rimUnitNum * 4).toFixed(2);
    return {
      id: `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category: 'service',
      // The PDF Brand column shows the actual tire brand — not "QuickRev".
      brand: tire.brand || '',
      // Nice PDF label, e.g. "STX81257H × 225/50R18 OVATION WV-688 Bundle"
      model: `${rimSku ? `${rimSku} × ` : ''}${normInput}${brandModel ? ` ${brandModel}` : ''} Bundle`,
      // Size column: tire size + rim spec (e.g. 18x8 · 5X112 · CB72.6).
      size: [normInput, rimSpec || (bolt || null)].filter(Boolean).join(' · '),
      price: bundlePrice,
      // Season pulls from the source tire (e.g. Winter) so the PDF shows it.
      season: tire.season || 'None',
      tier: 'service',
      stock: 1,
      includeInstall: false,
      isService: true,
      // One bundle per row — the PDF Qty column shows 1.
      bundleQty: 1,
      // Editable bundle fields (used by the quote line-item editor)
      isBundle: true,
      rimSku,
      tireSize: normInput,
      tireName: brandModel,
      tireUnit: +retail.toFixed(2),
      rimUnit: +rimUnitNum.toFixed(2),
      // Per-bundle install rate — rendered in the PDF Install/ea column.
      installRate: +installRate.toFixed(2),
      includeInstall: true,
      quoteQty: 1,
      _transient: true,
    };
  };

  // Installation line for bundles: one $X/set fee per job, added alongside
  // the bundle lines when Include Installation is enabled. The 10% discount
  // note is internal — never shown on the customer PDF.
  // Installation is shown per-row in the PDF's Install column — the old
  // separate "$X/set installation" quote line is no longer added.

  const flashAdded = (n) => {
    const inst = includeInstallation ? ` including ${formatCurrency(installRate)}/set installation` : '';
    setAddedMsg(`Added ${n} bundle${n === 1 ? '' : 's'} to the quote${inst} — open Search & Quote to generate the PDF.`);
    setTimeout(() => setAddedMsg(null), 4000);
  };

  const pushBundles = (items) => {
    if (!onAddBundles || items.length === 0) return;
    // Installation shows as the per-row Install column on the PDF now —
    // no separate installation line item anymore.
    onAddBundles(items);
    flashAdded(items.length);
  };

  const addOne = (entry) => {
    pushBundles([buildBundleItem(entry)]);
  };

  const addAll = () => {
    if (!onAddBundles || tireOptions.length === 0) return;
    pushBundles(tireOptions.map(buildBundleItem));
  };

  // === MULTI-SELECT ===
  // Tick the bundles you want, then "Add selected" — lets you build a mixed
  // quote (e.g. one winter + one all-season option) without adding everything.
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev => (prev.size > 0 ? new Set() : new Set(tireOptions.map(o => o.tire.id))));
  };
  const addSelected = () => {
    if (!onAddBundles || selectedIds.size === 0) return;
    const picks = tireOptions.filter(o => selectedIds.has(o.tire.id));
    pushBundles(picks.map(buildBundleItem));
    setSelectedIds(new Set());
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
      <div className="card p-4 mb-5 grid grid-cols-1 md:grid-cols-5 gap-3">
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
          <label className={label}>Install rate ($ / set)</label>
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
          <p className="text-xs text-muted mt-1">Added as its own line when Include Installation is on (Search & Quote).</p>
        </div>
        <div>
          <label className={label}>Rim price ($ / wheel)</label>
          {selectedSku && catalogRimPrice != null ? (
            // Rim is a catalog item — price is pulled automatically.
            <div>
              <div className="input w-full bg-gray-50 text-muted">{formatCurrency(catalogRimPrice)} <span className="text-xs">(from catalog)</span></div>
              <p className="text-xs text-muted mt-1">
                Rim price pulled from the catalog item — no entry needed.
                Bundle price = 4 tires + 4 rims (+{formatCurrency(catalogRimPrice * 4)}/bundle for rims).
              </p>
            </div>
          ) : (
            // Rim not in the catalog — ask for a price.
            <div>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputCls}
                placeholder="e.g. 99.00"
                value={rimUnit}
                onChange={e => setRimUnit(e.target.value)}
              />
              <p className="text-xs text-muted mt-1">
                {selectedSku
                  ? 'Rim not found in the catalog — enter the price per wheel.'
                  : 'Pick a rim SKU first; catalog rims price themselves.'}
                {rimUnitNum > 0 ? ` Bundle price = 4 tires + 4 rims (+${formatCurrency(rimUnitNum * 4)}/bundle for rims).` : ''}
              </p>
            </div>
          )}
        </div>
        <div className="md:col-span-5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInstallation}
              onChange={e => setIncludeInstallation(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">Include installation ({formatCurrency(installRate)}/set — added as its own quote line)</span>
          </label>
        </div>
      </div>

      {/* Step 2: catalog filters (distributor, warehouse, availability, season) */}
      <div className="card p-4 mb-5">
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
        {seasonOptions.length > 0 && (
          <div className="md:col-span-5">
            <label className={label}>Season</label>
            <div className="flex flex-wrap gap-2">
              {seasonOptions.map(s => {
                const on = activeSeasons.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setActiveSeasons(prev => {
                      const next = new Set(prev);
                      if (next.has(s)) next.delete(s); else next.add(s);
                      return next;
                    })}
                    style={{
                      padding: '2px 10px', fontSize: '0.75rem', borderRadius: 6,
                      border: '1px solid ' + (on ? '#0f172a' : '#cbd5e1'),
                      background: on ? '#0f172a' : '#fff',
                      color: on ? '#fff' : '#334155',
                      cursor: 'pointer',
                    }}
                    title={on ? `Click to stop filtering by ${s}` : `Show only ${s} tires`}
                  >
                    {s}
                  </button>
                );
              })}
              {activeSeasons.size > 0 && (
                <button type="button" className="text-xs text-danger font-medium" onClick={() => setActiveSeasons(new Set())}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
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
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button className="btn btn-sm btn-primary" onClick={addSelected} disabled={!onAddBundles} title="Add only the ticked bundles to the quote">
                <ShoppingCart className="w-4 h-4" />
                Add selected ({selectedIds.size})
              </button>
            )}
            <button className="btn btn-sm btn-outline" onClick={toggleSelectAll} title="Tick every visible bundle (or untick all)">
              {selectedIds.size > 0 ? 'Deselect all' : 'Select all'}
            </button>
            <button className="btn btn-sm btn-primary" onClick={addAll} disabled={!onAddBundles}>
              <ShoppingCart className="w-4 h-4" />
              Add all to quote
            </button>
          </div>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-xs uppercase text-muted">
                <th className="px-2 py-2 w-8">
                  <button type="button" onClick={toggleSelectAll} title={selectedIds.size > 0 ? 'Deselect all' : 'Select all'} style={{ cursor: 'pointer' }}>
                    {selectedIds.size > 0
                      ? <CheckSquare className="w-4 h-4 text-accent" />
                      : <Square className="w-4 h-4 text-muted" />}
                  </button>
                </th>
                <th className="px-3 py-2">Bundle</th>
                <th className="px-3 py-2">Brand / Model</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2 text-right">Tires (ea)</th>
                <th className="px-3 py-2 text-right">Rims (ea)</th>
                <th className="px-3 py-2 text-right">Price / bundle</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tireOptions.map(({ tire, retail }) => {
                const bundleName = `${selectedRim ? selectedRim.sku : '? SKU'} × ${normInput} ${[tire.brand, tire.model].filter(Boolean).join(' ')} Bundle`.trim();
                // Distributor label — the same tire can exist under multiple
                // distributors at different prices; show which one each row uses.
                const distName = (distributors.find(d => d.id === tire.distributorId) || {}).name || tire.distributorId || '';
                return (
                  <tr
                    key={tire.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                    style={selectedIds.has(tire.id) ? { background: '#eff6ff' } : undefined}
                  >
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => toggleSelect(tire.id)} title="Tick to include this bundle in 'Add selected'" style={{ cursor: 'pointer' }}>
                        {selectedIds.has(tire.id)
                          ? <CheckSquare className="w-4 h-4 text-accent" />
                          : <Square className="w-4 h-4 text-muted" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-semibold text-primary">{bundleName}{distName && <span className="text-xs text-muted font-normal"> · {distName}</span>}</td>
                    <td className="px-3 py-2">{[tire.brand, tire.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tire.size}
                      {rimSpec ? <span className="text-muted text-xs"> · {rimSpec}</span> : (selectedRim && selectedRim.boltPattern ? <span className="text-muted text-xs"> · {selectedRim.boltPattern}</span> : null)}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(retail)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(rimUnitNum)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(retail * 4 + rimUnitNum * 4)}</td>
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
