import { useMemo, useState } from 'react';
import { Search, Plus, Check, Car, X, AlertTriangle, ShieldCheck, Layers } from 'lucide-react';

/**
 * Fitment Finder — search by year / make / model / trim to get the stock SKU
 * for each possible rim size on that vehicle, set a wholesale rate on any
 * result, and add it as a new catalog item (skipped if already added).
 *
 * Supports Exact-Fit vs. Multi-Application SKUs, and vehicle fitment notes
 * (e.g. Brembo Brakes, Sport Packages, Track Handling Pkg).
 */

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Year-range fitments ("2025-2027", from the Rim Guide import) — a single
// selected year matches when it falls inside the range.
function yearMatches(f, year) {
  const y = String(f.year || '').trim();
  if (!year || !y) return true;
  const m = y.match(/^(\d{4})-(\d{4})$/);
  if (m) return +year >= Math.min(+m[1], +m[2]) && +year <= Math.max(+m[1], +m[2]);
  return y === String(year);
}

export default function FitmentFinder({ fitments = [], onAddFitment, addTire, tires = [], distributorId = 'canadaTire' }) {
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [wholesaleBySku, setWholesaleBySku] = useState({});
  const [addedSkus, setAddedSkus] = useState({});

  const years = useMemo(() => {
    const set = new Set();
    for (const f of fitments) {
      const y = String(f.year || '').trim();
      if (!y) continue;
      const m = y.match(/^(\d{4})-(\d{4})$/);
      if (m) {
        // Cap range expansion so one huge row can't explode the dropdown.
        const lo = Math.min(+m[1], +m[2]), hi = Math.max(+m[1], +m[2]);
        if (hi - lo <= 60) for (let i = lo; i <= hi; i++) set.add(String(i));
        else set.add(y);
      } else {
        set.add(y);
      }
    }
    return [...set].sort((a, b) => b - a);
  }, [fitments]);

  const makes = useMemo(() => {
    const set = new Set();
    for (const f of fitments) {
      if (year && !yearMatches(f, year)) continue;
      if (f.make) set.add(f.make);
    }
    return [...set].sort();
  }, [fitments, year]);

  const models = useMemo(() => {
    const set = new Set();
    for (const f of fitments) {
      if (year && !yearMatches(f, year)) continue;
      if (make && f.make !== make) continue;
      if (f.model) set.add(f.model);
    }
    return [...set].sort();
  }, [fitments, year, make]);

  const trims = useMemo(() => {
    const set = new Set();
    for (const f of fitments) {
      if (year && !yearMatches(f, year)) continue;
      if (make && f.make !== make) continue;
      if (model && f.model !== model) continue;
      if (f.trim) set.add(f.trim);
    }
    return [...set].sort();
  }, [fitments, year, make, model]);

  const results = useMemo(() => {
    const y = normalize(year), ma = normalize(make), mo = normalize(model), t = normalize(trim);
    return fitments.filter(f => {
      if (y && !yearMatches(f, year)) return false;
      if (ma && normalize(f.make) !== ma) return false;
      if (mo) {
        const normFitModel = normalize(f.model);
        if (!normFitModel.includes(mo) && !mo.includes(normFitModel)) return false;
      }
      if (t && !(normalize(f.trim) || '').includes(t)) return false;
      return true;
    });
  }, [fitments, year, make, model, trim]);

  // Aggregate: one row per rim size with its SKU(s), Exact-Fit vs Multi-Fit, and Notes
  const rows = useMemo(() => {
    const byRim = new Map();
    for (const f of results) {
      const rim = f.rimSize || f.rim || '';
      if (!rim) continue;
      const key = String(rim);
      if (!byRim.has(key)) {
        byRim.set(key, {
          rimSize: key,
          skus: new Set(),
          exactFitSkus: new Set(),
          multiFitSkus: new Set(),
          notes: new Set(),
          sources: new Set()
        });
      }
      const row = byRim.get(key);
      if (f.sku) {
        String(f.sku).split(',').map(s => s.trim()).filter(Boolean).forEach(s => row.skus.add(s));
      }
      if (f.exactFitSkus) {
        String(f.exactFitSkus).split(',').map(s => s.trim()).filter(Boolean).forEach(s => row.exactFitSkus.add(s));
      }
      if (f.multiFitSkus) {
        String(f.multiFitSkus).split(',').map(s => s.trim()).filter(Boolean).forEach(s => row.multiFitSkus.add(s));
      }
      if (f.notes) {
        String(f.notes).split(';').map(n => n.trim()).filter(Boolean).forEach(n => row.notes.add(n));
      }
      if (f.source) row.sources.add(f.source);
      if (f.boltPattern) row.boltPattern = f.boltPattern;
      if (f.offset) row.offset = f.offset;
      if (f.width) row.width = f.width;
    }
    return [...byRim.values()].map(r => ({
      ...r,
      skus: [...r.skus],
      exactFitSkus: [...r.exactFitSkus],
      multiFitSkus: [...r.multiFitSkus],
      notes: [...r.notes],
      sources: [...r.sources]
    })).sort((a, b) => parseInt(a.rimSize) - parseInt(b.rimSize));
  }, [results]);

  const alreadyAdded = (sku, rimSize) => {
    return tires.some(t => {
      const hay = `${t.sku || ''} ${t.model || ''} ${t.size || ''}`.toLowerCase();
      if (sku && hay.includes(String(sku).toLowerCase())) return true;
      return normalize(t.size) === normalize(rimSize) && t.category === 'wheel';
    });
  };

  const handleAdd = (row) => {
    const sku = row.exactFitSkus[0] || row.multiFitSkus[0] || row.skus[0] || `${normalize(make)}-${row.rimSize}`;
    const ws = parseFloat(wholesaleBySku[row.rimSize]) || 0;
    const exists = alreadyAdded(sku, row.rimSize);
    if (exists) {
      setAddedSkus(a => ({ ...a, [row.rimSize]: 'exists' }));
      return;
    }

    let notesText = `Fitment: ${year} ${make} ${model}${trim ? ` ${trim}` : ''} — rim ${row.rimSize}"`;
    if (row.notes.length > 0) {
      notesText += ` [${row.notes.join('; ')}]`;
    }

    addTire({
      brand: make || 'OEM',
      model: `${year} ${make} ${model}${trim ? ` ${trim}` : ''}`.trim(),
      size: `${row.rimSize}X${row.width || '7'}` + (row.offset != null ? ` ${row.offset}` : '') + (row.boltPattern ? ` ${row.boltPattern}` : ''),
      wholesale: ws,
      stock: 0,
      season: 'None',
      category: 'wheel',
      distributorId,
      sku,
      notes: notesText,
      wholesaleOverride: ws,
    });
    setAddedSkus(a => ({ ...a, [row.rimSize]: 'added' }));
  };

  const label = 'text-sm font-medium mb-1 block text-primary';
  const inputCls = 'input w-full';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Car className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold text-primary">Fitment Finder</h2>
      </div>
      <p className="text-sm text-muted mb-4">
        Search by vehicle to see every possible rim size, Exact-Fit and Multi-Application SKUs, and vehicle notes (such as Brembo Brakes). Set a wholesale rate per result, then add it as a catalog item — items that already exist are skipped.
      </p>

      {/* Search form */}
      <div className="card p-4 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>Year</label>
          <select className={inputCls} value={year} onChange={e => {
            const nextYear = e.target.value;
            setYear(nextYear);
            if (nextYear && make) {
              const hasMake = fitments.some(f => String(f.year) === nextYear && f.make === make);
              if (!hasMake) { setMake(''); setModel(''); setTrim(''); }
              else if (model) {
                const hasModel = fitments.some(f => String(f.year) === nextYear && f.make === make && f.model === model);
                if (!hasModel) { setModel(''); setTrim(''); }
              }
            }
          }}>
            <option value="">Any</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Make</label>
          <select className={inputCls} value={make} onChange={e => {
            const nextMake = e.target.value;
            setMake(nextMake);
            if (nextMake && model) {
              const hasModel = fitments.some(f => (!year || String(f.year) === year) && f.make === nextMake && f.model === model);
              if (!hasModel) { setModel(''); setTrim(''); }
            } else if (!nextMake) {
              setModel(''); setTrim('');
            }
          }}>
            <option value="">Any</option>
            {makes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Model</label>
          <select className={inputCls} value={model} onChange={e => { setModel(e.target.value); setTrim(''); }}>
            <option value="">Any</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Trim</label>
          <select className={inputCls} value={trim} onChange={e => setTrim(e.target.value)}>
            <option value="">Any</option>
            {trims.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Results */}
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-muted">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No fitment data matches. Select a vehicle above or add fitments manually.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-xs uppercase text-muted">
                <th className="px-3 py-2">Rim Size</th>
                <th className="px-3 py-2">Spec</th>
                <th className="px-3 py-2">Exact-Fit SKU</th>
                <th className="px-3 py-2">Multi-App SKU</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 w-32">Wholesale</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const primarySku = row.exactFitSkus[0] || row.multiFitSkus[0] || row.skus[0];
                const state = addedSkus[row.rimSize];
                const exists = alreadyAdded(primarySku, row.rimSize);
                const unassignedSkus = row.skus.filter(s => !row.exactFitSkus.includes(s) && !row.multiFitSkus.includes(s));
                return (
                  <tr key={row.rimSize} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-bold text-primary whitespace-nowrap">{row.rimSize}"</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">
                      {row.width ? `${row.rimSize}×${row.width}` : ''}{row.offset != null ? ` ET${row.offset}` : ''}{row.boltPattern ? ` ${row.boltPattern}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      {row.exactFitSkus.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.exactFitSkus.map(sku => (
                            <span key={sku} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-emerald-50 text-emerald-700 border border-emerald-200" title="Exact-Fit SKU">
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              {sku}
                            </span>
                          ))}
                        </div>
                      ) : unassignedSkus.length > 0 && row.multiFitSkus.length === 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {unassignedSkus.map(sku => (
                            <span key={sku} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-700 border border-slate-300" title="Standard SKU">
                              {sku}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.multiFitSkus.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.multiFitSkus.map(sku => (
                            <span key={sku} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200" title="Multi-Application SKU">
                              <Layers className="w-3 h-3 text-blue-500" />
                              {sku}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.notes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.notes.map((note, idx) => (
                            <span
                              key={idx}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                note.toLowerCase().includes('brembo') || note.toLowerCase().includes('brake')
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-slate-100 text-slate-800 border border-slate-200'
                              }`}
                            >
                              <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-600" />
                              {note}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input w-28 text-sm"
                        placeholder="$"
                        value={wholesaleBySku[row.rimSize] ?? ''}
                        onChange={e => setWholesaleBySku(w => ({ ...w, [row.rimSize]: e.target.value }))}
                      />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        className="btn btn-sm text-white bg-green-600 hover:bg-green-700 inline-flex items-center gap-1"
                        onClick={() => handleAdd(row)}
                        disabled={state === 'added' || state === 'exists'}
                        title={exists ? 'Already in catalog' : 'Add as a new wheel item'}
                      >
                        {state === 'added' ? <><Check className="w-4 h-4" /> Added</>
                          : state === 'exists' ? <><X className="w-4 h-4" /> In catalog</>
                          : <><Plus className="w-4 h-4" /> Add item</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual fitment entry */}
      <ManualFitmentForm onAddFitment={onAddFitment} years={years} />
    </div>
  );
}

function ManualFitmentForm({ onAddFitment, years }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ year: '', make: '', model: '', trim: '', rimSize: '', width: '', offset: '', boltPattern: '', exactFitSkus: '', multiFitSkus: '', notes: '' });
  const label = 'text-sm font-medium mb-1 block text-primary';
  const inputCls = 'input w-full';
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.year || !form.make || !form.model || !form.rimSize) return;
    const allSkus = [form.exactFitSkus, form.multiFitSkus].filter(Boolean).join(',');
    onAddFitment({ ...form, sku: allSkus, year: parseInt(form.year, 10) });
    setForm(f => ({ ...f, rimSize: '', width: '', offset: '', boltPattern: '', exactFitSkus: '', multiFitSkus: '', notes: '' }));
  };

  if (!open) {
    return (
      <button className="btn btn-sm mt-4 inline-flex items-center gap-1" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4" /> Add fitment manually
      </button>
    );
  }
  return (
    <form className="card p-4 mt-5 grid grid-cols-2 md:grid-cols-4 gap-3" onSubmit={submit}>
      <div className="col-span-2 md:col-span-4 flex items-center justify-between">
        <h3 className="font-bold text-primary">Add fitment entry</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div><label className={label}>Year *</label><input className={inputCls} value={form.year} onChange={set('year')} placeholder="2020" /></div>
      <div><label className={label}>Make *</label><input className={inputCls} value={form.make} onChange={set('make')} placeholder="Honda" /></div>
      <div><label className={label}>Model *</label><input className={inputCls} value={form.model} onChange={set('model')} placeholder="Civic" /></div>
      <div><label className={label}>Trim</label><input className={inputCls} value={form.trim} onChange={set('trim')} placeholder="LX" /></div>
      <div><label className={label}>Rim size (in) *</label><input className={inputCls} value={form.rimSize} onChange={set('rimSize')} placeholder="17" /></div>
      <div><label className={label}>Width</label><input className={inputCls} value={form.width} onChange={set('width')} placeholder="7" /></div>
      <div><label className={label}>Offset</label><input className={inputCls} value={form.offset} onChange={set('offset')} placeholder="45" /></div>
      <div><label className={label}>Bolt pattern</label><input className={inputCls} value={form.boltPattern} onChange={set('boltPattern')} placeholder="5x114.3" /></div>
      <div><label className={label}>Exact-Fit SKU</label><input className={inputCls} value={form.exactFitSkus} onChange={set('exactFitSkus')} placeholder="STX..." /></div>
      <div><label className={label}>Multi-App SKU</label><input className={inputCls} value={form.multiFitSkus} onChange={set('multiFitSkus')} placeholder="STX..." /></div>
      <div className="col-span-2"><label className={label}>Notes</label><input className={inputCls} value={form.notes} onChange={set('notes')} placeholder="e.g. Except Brembo Brakes" /></div>
      <div className="col-span-2 md:col-span-4">
        <button type="submit" className="btn btn-sm text-white bg-green-600 hover:bg-green-700">Save fitment</button>
      </div>
    </form>
  );
}
