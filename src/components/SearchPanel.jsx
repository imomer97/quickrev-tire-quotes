import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search, Download, Check, X, Pencil, Trash2, ChevronDown,
  FileText, CheckSquare, Square, Filter, ArrowUpDown,
  Car, Wrench, Info, Plus, GripVertical, ListOrdered
} from 'lucide-react';
import {
  DISTRIBUTORS,
  SEASONS,
  TIERS,
  VEHICLE_LABELS,
  calculatePurchaseCost,
  calculateInstallationPerTire,
  parseTireSize,
  formatCurrency,
  ENV_FEE_PER_TIRE,
  MARKUP_PER_TIRE,
  HST_RATE,
  getTierForBrand,
  getRegularPrice,
  getSaleInfo,
  getEffectiveRetail,
  resolvePostalCode,
} from '../data/distributors.js';
import { generateOptionsPDF } from '../utils/pdfGenerator.js';

export default function SearchPanel({ tires, updateTire, deleteTire, addTire, bulkUpdateTires, warehouseLocations, distributors, onAddDistributor }) {
  // === SEARCH & FILTERS ===
  const [searchSize, setSearchSize] = useState('');
  const [quantity, setQuantity] = useState(4);
  const [activeDistributors, setActiveDistributors] = useState(new Set());
  // Canada Tire shows one option per synced warehouse (e.g. "Canada Tire —
  // Dartmouth, NS") so stock can be viewed per warehouse. The general
  // "Canada Tire" option means all warehouses (summed stock).
  const distributorOptions = useMemo(() => {
    const opts = [];
    for (const d of distributors) {
      opts.push({ id: d.id, label: d.name });
      if (d.id === 'canadaTire') {
        for (const loc of warehouseLocations) {
          opts.push({ id: `ct:${loc}`, label: `Canada Tire — ${loc}` });
        }
      }
    }
    return opts;
  }, [distributors, warehouseLocations]);
  // When exactly one Canada Tire warehouse is selected (and the general
  // "Canada Tire" option is off), stock refers to that warehouse only.
  const activeLocations = [...activeDistributors]
    .filter(id => id.startsWith('ct:'))
    .map(id => id.slice(3));
  const singleActiveLocation =
    !activeDistributors.has('canadaTire') && activeLocations.length === 1
      ? activeLocations[0]
      : null;
  const getTireStock = useCallback((tire) => {
    if (singleActiveLocation) {
      return (tire.inventory || []).find(l => l.location === singleActiveLocation)?.quantity ?? 0;
    }
    return tire.stock || 0;
  }, [singleActiveLocation]);
  const [activeTiers, setActiveTiers] = useState(new Set(Object.keys(TIERS)));
  const [activeSeasons, setActiveSeasons] = useState(new Set(SEASONS));
  const [sortBy, setSortBy] = useState('price-asc');
  const [showInstall, setShowInstall] = useState(true);
  const [vehicleType, setVehicleType] = useState('');
  const [buyFromQuickRev, setBuyFromQuickRev] = useState(true);
  const [customerName, setCustomerName] = useState('');
  // PDF-only field: the size shown on the generated quote (independent of the search box)
  const [pdfTireSize, setPdfTireSize] = useState('');
  // Number of the purchased tires that will actually be installed (e.g. buy 4, install 2)
  const [installQty, setInstallQty] = useState(4);

  // === TRAVEL SURCHARGE (per postal code) ===
  const [postalCode, setPostalCode] = useState('');
  // Multi-area FSAs (e.g. B2W) need a sub-area pick; index into the options
  const [postalSubOption, setPostalSubOption] = useState(0);
  const postalInfo = useMemo(
    () => resolvePostalCode(postalCode, postalSubOption),
    [postalCode, postalSubOption]
  );

  // === EDIT MODE ===
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // === MULTI-SELECT ===
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);
  // === QUOTE (persistent across searches) ===
  // Items deliberately "added to the quote" survive search/filter changes.
  // Each entry is a snapshot of the tire so the quote stays intact even if the
  // catalog is edited or the item is deleted later.
  const [quoteItems, setQuoteItems] = useState([]);
  // When true, the user has manually dragged items into a custom order, which
  // overrides the PDF's automatic price sort. Reset when the quote is cleared.
  const [manualQuoteOrder, setManualQuoteOrder] = useState(false);
  // Expandable per-warehouse stock breakdown on a card
  const [expandedStockId, setExpandedStockId] = useState(null);
  // === RESULTS PAGINATION ===
  // A full-catalog sync can hold thousands of tires; rendering them all at once
  // freezes the page. Show a window and let the user reveal more.
  const [visibleCount, setVisibleCount] = useState(100);
  useEffect(() => {
    setVisibleCount(100);
  }, [searchSize, activeDistributors, activeTiers, activeSeasons]);
  // === BULK EDIT ===
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);
  const [bulkForm, setBulkForm] = useState({
    distributorId: '',
    stock: '',
    price: '',
    adjustMode: 'increase',
    adjustBy: '',
    adjustUnit: '$',
    season: '',
    salePrice: '',
    saleStart: '',
    saleEnd: '',
    clearSale: false,
    includeInstall: '',
    isFree: '',
  });

  // === ADD TIRE MODAL ===
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTireForm, setNewTireForm] = useState({
    brand: '',
    model: '',
    size: '',
    wholesale: '',
    stock: '',
    season: 'All-Season',
    distributorId: 'canadaTire',
    includeInstall: true,
    isFree: false,
    salePrice: '',
    saleStart: '',
    saleEnd: '',
  });

  // === TOGGLES ===
  const toggleDistributor = (id) => {
    setActiveDistributors(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTier = (tier) => {
    setActiveTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  const toggleSeason = (season) => {
    setActiveSeasons(prev => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });
  };

  // === NORMALIZE TIRE SIZE FOR SEARCHING ===
  // Convert all tire formats to normalized forms for matching:
  //   "205/55R16"  → alphanumeric "20555r16" + numeric "2055516"
  //   "20555R16"   → alphanumeric "20555r16" + numeric "2055516"
  //   "2055516"    → alphanumeric "2055516" + numeric "2055516"
  // Matching against either form means all three input formats find the same tire.
  const normalizeTireSize = (size) => {
    if (!size) return '';
    return size.toLowerCase().replace(/[^0-9a-z]/g, '');
  };

  // Numeric-only form (strips the R / letters): "205/55R16" → "2055516"
  const normalizeTireSizeNumeric = (size) => {
    if (!size) return '';
    return size.toLowerCase().replace(/[^0-9]/g, '');
  };

  // Price / sale helpers (getRegularPrice, getSaleInfo, getEffectiveRetail) are
  // shared from ../data/distributors.js so the PDF generator stays in sync.

  // === FILTER & SORT LOGIC ===
  const filteredTires = useMemo(() => {
    let results = tires.filter(tire => {
      // FIXED: Multi-field search (brand, model, size with special char handling)
      if (searchSize) {
        const searchLower = searchSize.toLowerCase();
        const normalizedSearch = normalizeTireSize(searchSize);
        const numericSearch = normalizeTireSizeNumeric(searchSize);
        const normalizedTireSize = normalizeTireSize(tire.size);
        const numericTireSize = normalizeTireSizeNumeric(tire.size);
        
        // Match if:
        // 1. Alphanumeric normalized size matches (e.g., "20555r16" vs "205/55R16")
        // 2. Numeric-only form matches (so "2055516" finds a tire stored as "205/55R16")
        // 3. Raw size string contains the search string
        // 4. Brand contains search string
        // 5. Model contains search string
        // Guard against empty strings: .includes('') is true for every tire,
        // so a letters-only search (brand/model) must not match on size.
        const normSizeMatch = normalizedSearch.length > 0
          && normalizedTireSize.includes(normalizedSearch);
        const numericMatch = numericSearch.length > 0
          && numericTireSize.includes(numericSearch);
        const sizeMatch = normSizeMatch || numericMatch || tire.size.toLowerCase().includes(searchLower);
        const brandMatch = tire.brand.toLowerCase().includes(searchLower);
        const modelMatch = tire.model.toLowerCase().includes(searchLower);
        
        if (!sizeMatch && !brandMatch && !modelMatch) return false;
      }
      // Distributor — general options plus per-warehouse Canada Tire options
      const distMatch = activeDistributors.has(tire.distributorId)
        || (tire.distributorId === 'canadaTire' && [...activeDistributors].some(id =>
            id.startsWith('ct:') && (tire.inventory || []).some(l => l.location === id.slice(3))));
      if (!distMatch) return false;
      // Tier
      if (!activeTiers.has(tire.tier)) return false;
      // Season
      if (!activeSeasons.has(tire.season)) return false;
      return true;
    });

    // Sort (pre-tax total based on the effective price, so sales affect order)
    results = [...results].sort((a, b) => {
      const aParsed = parseTireSize(a.size);
      const bParsed = parseTireSize(b.size);
      const aRetail = getEffectiveRetail(a);
      const bRetail = getEffectiveRetail(b);
      const aInstall = showInstall && a.includeInstall !== false && aParsed
        ? calculateInstallationPerTire(aParsed.width, aParsed.aspect, aParsed.rim, vehicleType, buyFromQuickRev)
        : 0;
      const bInstall = showInstall && b.includeInstall !== false && bParsed
        ? calculateInstallationPerTire(bParsed.width, bParsed.aspect, bParsed.rim, vehicleType, buyFromQuickRev)
        : 0;
      const aTotal = aRetail + aInstall;
      const bTotal = bRetail + bInstall;

      switch (sortBy) {
        case 'price-asc': return aTotal - bTotal;
        case 'price-desc': return bTotal - aTotal;
        case 'brand-asc': return a.brand.localeCompare(b.brand);
        case 'stock-desc': return getTireStock(b) - getTireStock(a);
        default: return 0;
      }
    });

    return results;
  }, [tires, searchSize, activeDistributors, activeTiers, activeSeasons, sortBy, showInstall, vehicleType, buyFromQuickRev, getTireStock, getEffectiveRetail]);

  function getTireCalculations(tire) {
    const parsed = parseTireSize(tire.size);
    const retailPrice = getEffectiveRetail(tire);
    const hst = retailPrice * HST_RATE;
    const tireTotal = retailPrice + hst;
    const sale = getSaleInfo(tire);

    if (!parsed) {
      return {
        purchaseCost: calculatePurchaseCost(tire.wholesale),
        retailPrice,
        regularPrice: getRegularPrice(tire),
        hst,
        tireTotal,
        sale,
        installPerTire: 0,
        totalPreTax: retailPrice,
        totalHST: hst,
        totalPerTire: tireTotal,
      };
    }

    const installEligible = showInstall && tire.includeInstall !== false;
    const installPerTire = installEligible ? calculateInstallationPerTire(
      parsed.width, parsed.aspect, parsed.rim, vehicleType, buyFromQuickRev
    ) : 0;
    // Combined pre-tax (tire at effective price + installation), HST on both
    const preTax = installEligible ? retailPrice + installPerTire : retailPrice;
    const totalHST = preTax * HST_RATE;

    return {
      purchaseCost: calculatePurchaseCost(tire.wholesale),
      retailPrice,
      regularPrice: getRegularPrice(tire),
      hst,
      tireTotal,
      sale,
      installPerTire,
      totalPreTax: preTax,
      totalHST,
      totalPerTire: preTax + totalHST,
    };
  }

  // === EDIT HANDLERS ===
  const startEdit = (tire) => {
    setEditingId(tire.id);
    setEditForm({ ...tire });
  };

  const saveEdit = () => {
    if (!editForm.brand || !editForm.model || !editForm.size) return;
    const distributorId = editForm.distributorId || 'canadaTire';
    // Empty price/sale fields clear the override back to the computed retail
    const price = (editForm.price === '' || editForm.price === undefined || editForm.price === null)
      ? null : parseFloat(editForm.price) || null;
    const salePrice = (editForm.salePrice === '' || editForm.salePrice === undefined || editForm.salePrice === null)
      ? null : parseFloat(editForm.salePrice) || null;
    updateTire(editingId, {
      brand: editForm.brand,
      model: editForm.model,
      size: editForm.size.toUpperCase(),
      wholesale: parseFloat(editForm.wholesale) || 0,
      stock: parseInt(editForm.stock, 10) || 0,
      season: editForm.season,
      distributorId,
      tier: getTierForBrand(distributorId, editForm.brand),
      price,
      salePrice,
      saleStart: editForm.saleStart || null,
      saleEnd: editForm.saleEnd || null,
      includeInstall: !!editForm.includeInstall,
      isFree: !!editForm.isFree,
    });
    setEditingId(null);
    setEditForm({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // === MULTI-SELECT HANDLERS ===
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedIds.size === filteredTires.length && filteredTires.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTires.map(t => t.id)));
    }
  };

  // === BULK EDIT ===
  const applyBulkEdit = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const updates = {};
    if (bulkForm.distributorId) updates.distributorId = bulkForm.distributorId;
    if (bulkForm.stock !== '') updates.stock = parseInt(bulkForm.stock, 10) || 0;
    if (bulkForm.price !== '') updates.price = parseFloat(bulkForm.price) || 0;
    if (bulkForm.season) updates.season = bulkForm.season;
    if (bulkForm.salePrice !== '') updates.salePrice = parseFloat(bulkForm.salePrice) || 0;
    if (bulkForm.saleStart) updates.saleStart = bulkForm.saleStart;
    if (bulkForm.saleEnd) updates.saleEnd = bulkForm.saleEnd;
    if (bulkForm.clearSale) {
      updates.salePrice = null;
      updates.saleStart = null;
      updates.saleEnd = null;
    }
    if (bulkForm.includeInstall !== '') updates.includeInstall = bulkForm.includeInstall === 'true';
    if (bulkForm.isFree !== '') updates.isFree = bulkForm.isFree === 'true';
    // Increase / decrease the price (regular, pre-tax) by an amount or percentage
    if (bulkForm.adjustBy !== '') {
      const amt = parseFloat(bulkForm.adjustBy) || 0;
      if (amt !== 0) updates.priceAdjust = { mode: bulkForm.adjustMode, amount: amt, unit: bulkForm.adjustUnit };
    }
    if (Object.keys(updates).length === 0) return;
    bulkUpdateTires(ids, updates);
    setBulkMsg(`Applied to ${ids.length} tire(s)`);
    setTimeout(() => setBulkMsg(null), 2500);
    setBulkForm({
      distributorId: '', stock: '', price: '', adjustMode: 'increase', adjustBy: '', adjustUnit: '$',
      season: '', salePrice: '', saleStart: '', saleEnd: '', clearSale: false,
      includeInstall: '', isFree: '',
    });
  };

  // === ADD TIRE HANDLER ===
  const handleAddTire = () => {
    if (!newTireForm.brand || !newTireForm.model || !newTireForm.size) {
      alert('Brand, Model, and Size are required.');
      return;
    }
    addTire({
      brand: newTireForm.brand,
      model: newTireForm.model,
      size: newTireForm.size.toUpperCase(),
      wholesale: parseFloat(newTireForm.wholesale) || 0,
      stock: parseInt(newTireForm.stock, 10) || 0,
      season: newTireForm.season || 'All-Season',
      distributorId: newTireForm.distributorId,
      includeInstall: newTireForm.includeInstall !== false,
      isFree: !!newTireForm.isFree,
      salePrice: newTireForm.salePrice !== '' && newTireForm.salePrice != null
        ? parseFloat(newTireForm.salePrice) : undefined,
      saleStart: newTireForm.saleStart || undefined,
      saleEnd: newTireForm.saleEnd || undefined,
    });
    setNewTireForm({
      brand: '',
      model: '',
      size: '',
      wholesale: '',
      stock: '',
      season: 'All-Season',
      distributorId: 'canadaTire',
      includeInstall: true,
      isFree: false,
      salePrice: '',
      saleStart: '',
      saleEnd: '',
    });
    setShowAddModal(false);
  };

  // === QUOTE HANDLERS ===
  // Moves the currently selected search results into the persistent quote,
  // then clears the transient selection so the user can search again.
  const addSelectedToQuote = () => {
    if (selectedIds.size === 0) return;
    const items = filteredTires.filter(t => selectedIds.has(t.id));
    setQuoteItems(prev => {
      const seen = new Set(prev.map(i => i.id));
      const toAdd = items.filter(t => !seen.has(t.id));
      return [...prev, ...toAdd];
    });
    setSelectedIds(new Set());
  };

  const removeFromQuote = (id) => {
    setQuoteItems(prev => prev.filter(i => i.id !== id));
  };

  const clearQuote = () => {
    if (quoteItems.length === 0) return;
    setQuoteItems([]);
    setManualQuoteOrder(false);
  };

  // === QUOTE DRAG-TO-REORDER ===
  // Index of the item currently being dragged (native HTML5 drag-and-drop,
  // no library needed). Reordering switches the quote into manual order mode,
  // which the PDF respects instead of auto-sorting by price.
  const dragIndex = useRef(null);
  const reorderQuote = (from, to) => {
    if (from === to) return;
    setQuoteItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setManualQuoteOrder(true);
  };

  // === QUOTE ONE-CLICK SORT ===
  // Reorders the quote list in place (Price low→high with free items last, or
  // Brand A–Z). Applying a sort also pins the list as a manual order so the
  // PDF renders the items exactly as shown here.
  const sortQuoteList = (mode) => {
    if (quoteItems.length < 2) return;
    setQuoteItems(prev => {
      const next = [...prev];
      if (mode === 'price') {
        next.sort((a, b) => {
          if (a.isFree !== b.isFree) return a.isFree ? 1 : -1;
          return (getEffectiveRetail(a) || 0) - (getEffectiveRetail(b) || 0);
        });
      } else if (mode === 'az') {
        next.sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));
      }
      return next;
    });
    setManualQuoteOrder(true);
  };

  // === PDF GENERATION ===
  const handleGeneratePDF = () => {
    if (quoteItems.length === 0) {
      alert('Add at least one item to the quote first.');
      return;
    }
    if (!vehicleType) {
      alert('Please select a vehicle type before generating the PDF.');
      return;
    }
    generateOptionsPDF({
      tires: quoteItems,
      quantity,
      vehicleType,
      buyFromQuickRev,
      includeInstallation: showInstall,
      customerName,
      tireSize: pdfTireSize,
      installQty,
      postalCode,
      travelSurcharge: showInstall ? postalInfo.surcharge : 0,
      // Manual drag order overrides the automatic price sort in the PDF.
      preserveOrder: manualQuoteOrder,
    });
  };

  // === COPY QUOTE TEXT ===
  const copyQuote = (tire) => {
    const calc = getTireCalculations(tire);
    const installPerTire = showInstall && tire.includeInstall !== false ? (calc.installPerTire || 0) : 0;
    const tiresTotal = calc.tireTotal * quantity;
    const installTotal = installPerTire > 0 ? installPerTire * installQty * (1 + HST_RATE) : 0;
    const travelSurcharge = showInstall ? postalInfo.surcharge : 0;
    const grandTotal = tiresTotal + installTotal + travelSurcharge;

    const stockText = singleActiveLocation
      ? `Stock @ ${singleActiveLocation}: ${getTireStock(tire)} available`
      : `Stock: ${getTireStock(tire)} available`;
    const text = `QuickRev Tire Options — ${tire.size}
\n${tire.brand} ${tire.model} (${tire.season})
${quantity} tires × ${formatCurrency(calc.tireTotal)} = ${formatCurrency(tiresTotal)}
${installPerTire > 0 ? `${installQty} install(s) × ${formatCurrency(installPerTire)} (pre-tax) = ${formatCurrency(installTotal)}
` : ''}${travelSurcharge > 0 ? `Travel surcharge (per job): ${formatCurrency(travelSurcharge)}\n` : ''}Total: ${formatCurrency(grandTotal)}
${stockText}
\nquickrev.ca`;

    navigator.clipboard.writeText(text)
      .then(() => setCopiedId(tire.id))
      .catch(() => setCopiedId(tire.id));
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-col gap-6">
      {/* === SEARCH BAR & ADD TIRE === */}
      <div className="card p-6">
        <div className="flex flex-col gap-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                className="input pl-10"
                placeholder="Search tire size (e.g., 205/55R16)..."
                value={searchSize}
                onChange={(e) => setSearchSize(e.target.value)}
              />
            </div>
            <input
              type="number"
              className="input w-20"
              placeholder="Qty"
              min="1"
              max="20"
              title="Number of new tires being quoted"
              value={quantity}
              onChange={(e) => {
                const q = Math.max(1, parseInt(e.target.value) || 4);
                setQuantity(q);
                // Keep the install count in step with quantity until the user overrides it
                if (installQty === quantity) setInstallQty(q);
              }}
            />
            <input
              type="number"
              className="input w-20"
              placeholder="Install"
              min="0"
              max="20"
              title="Number of tires to be installed"
              value={installQty}
              onChange={(e) => setInstallQty(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <button 
              className="btn btn-success"
              onClick={() => setShowAddModal(true)}
              title="Add a new tire manually"
            >
              <Plus className="w-4 h-4" />
              Add Tire
            </button>
          </div>

          {/* === SEARCH HELP TEXT === */}
          <p className="text-xs text-muted ml-1">
            💡 Search by size (205/55R16, 20555R16, or 2055516), brand, or model. Results update as you type.
          </p>

          {/* === PDF SIZE FIELD === */}
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">New Tire Size (PDF)</label>
              <input
                type="text"
                className="input w-44 font-mono"
                placeholder="e.g. 205/55R16"
                value={pdfTireSize}
                onChange={(e) => setPdfTireSize(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted pb-2">
              Appears on the generated PDF only — independent of the search box.
            </p>
          </div>

          {/* === FILTER TOGGLES === */}
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-muted mb-2 uppercase">Distributors</p>
              <div className="flex flex-wrap gap-2">
                {distributorOptions.map(opt => (
                  <label
                    key={opt.id}
                    className={`flex items-center gap-2 cursor-pointer ${opt.id.startsWith('ct:') ? 'ml-4' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={activeDistributors.has(opt.id)}
                      onChange={() => toggleDistributor(opt.id)}
                      className="rounded"
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted mb-2 uppercase">Tier</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(TIERS).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeTiers.has(key)}
                      onChange={() => toggleTier(key)}
                      className="rounded"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted mb-2 uppercase">Season</p>
              <div className="flex flex-wrap gap-2">
                {SEASONS.map(s => (
                  <label key={s} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeSeasons.has(s)}
                      onChange={() => toggleSeason(s)}
                      className="rounded"
                    />
                    <span className="text-sm">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* === VEHICLE & INSTALLATION OPTIONS === */}
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Vehicle Type</label>
              <select
                className="input select"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
              >
                <option value="" disabled>Select vehicle type…</option>
                {Object.entries(VEHICLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInstall}
                onChange={(e) => setShowInstall(e.target.checked)}
              />
              <span className="text-sm font-medium">Include Installation</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={buyFromQuickRev}
                onChange={(e) => setBuyFromQuickRev(e.target.checked)}
              />
              <span className="text-sm font-medium">QuickRev 10% Discount</span>
            </label>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Postal Code</label>
              <input
                type="text"
                className="input w-24 font-mono uppercase"
                maxLength={3}
                placeholder="B3K"
                value={postalCode}
                onChange={(e) => {
                  setPostalCode(e.target.value);
                  setPostalSubOption(0);
                }}
              />
            </div>
            {postalInfo.options && postalInfo.options.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-muted mb-1 block uppercase">Area</label>
                <select
                  className="input select"
                  value={postalSubOption}
                  onChange={(e) => setPostalSubOption(Number(e.target.value))}
                >
                  {postalInfo.options.map((opt, i) => (
                    <option key={i} value={i}>
                      {opt.label} — {opt.fee === 0 ? 'No surcharge' : `+$${opt.fee}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {postalCode.trim() && !postalInfo.unknown && (
              <div className="pb-1">
                <span className={`text-xs font-medium ${postalInfo.surcharge > 0 ? 'text-warning' : 'text-success'}`}>
                  {postalInfo.surcharge > 0
                    ? `Travel: +$${postalInfo.surcharge.toFixed(2)} (${postalInfo.label})`
                    : `No travel surcharge (${postalInfo.label})`}
                </span>
              </div>
            )}
            {postalCode.trim() && postalInfo.unknown && (
              <div className="pb-1">
                <span className="text-xs font-medium text-warning">
                  {postalInfo.label} — confirm travel charges
                </span>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Sort</label>
              <select
                className="input select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="price-asc">Price (Low to High)</option>
                <option value="price-desc">Price (High to Low)</option>
                <option value="brand-asc">Brand (A-Z)</option>
                <option value="stock-desc">Stock (Most)</option>
              </select>
            </div>
            <input
              type="text"
              className="input flex-1 min-w-48"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleGeneratePDF} disabled={quoteItems.length === 0}>
              <Download className="w-4 h-4" />
              PDF ({quoteItems.length})
            </button>
          </div>
        </div>
      </div>

      {/* === QUOTE PANEL (persistent across searches) === */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            <h2 className="font-semibold">
              Quote {quoteItems.length > 0 && <span className="badge badge-blue">{quoteItems.length}</span>}
            </h2>
          </div>
          {quoteItems.length > 0 && (
            <div className="flex items-center gap-1">
              <button className="btn btn-sm btn-ghost" onClick={() => sortQuoteList('price')} title="Sort by price (low to high), free items last">
                <ArrowUpDown className="w-4 h-4 text-accent" />
                <span className="hide-sm">Price</span>
                <span className="show-sm">$</span>
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => sortQuoteList('az')} title="Sort by brand (A–Z)">
                A–Z
              </button>
              <button className="btn btn-sm btn-ghost text-danger" onClick={clearQuote} title="Remove all items">
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            </div>
          )}
        </div>
        {quoteItems.length === 0 ? (
          <p className="text-sm text-muted ml-1">
            Select tires above (with the checkbox) and click <span className="font-semibold">“Add selected to quote”</span>.
            Items stay in the quote while you search for more, then click <span className="font-semibold">PDF</span> when done.
          </p>
        ) : (
          <div>
            <p className="text-xs text-muted mb-2 flex items-center gap-1">
              <ListOrdered className="w-3.5 h-3.5" />
              Drag items to arrange them manually — the PDF follows your order.
            </p>
            <ul className="flex flex-col gap-2">
              {quoteItems.map((item, idx) => {
                const qCalc = getTireCalculations(item);
                return (
                  <li
                    key={item.id}
                    draggable
                    onDragStart={() => { dragIndex.current = idx; }}
                    onDragEnter={() => {
                      if (dragIndex.current == null || dragIndex.current === idx) return;
                      reorderQuote(dragIndex.current, idx);
                      dragIndex.current = idx;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={() => { dragIndex.current = null; }}
                    className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2"
                    style={{ cursor: 'grab' }}
                  >
                    <GripVertical className="w-4 h-4 text-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold mr-2">{item.brand} {item.model}</span>
                      <span className="badge badge-gray font-mono">{item.size}</span>
                      <span className="text-xs text-muted ml-2">
                        {quantity} × {formatCurrency(qCalc.tireTotal)} = {formatCurrency(qCalc.tireTotal * quantity)}
                      </span>
                    </div>
                    <button className="btn btn-sm btn-ghost p-1 text-danger" onClick={() => removeFromQuote(item.id)} title="Remove from quote">
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* === ADD TIRE MODAL === */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add Tire</h2>
            <div className="flex-col gap-3 mb-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Brand *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Nexen"
                  value={newTireForm.brand}
                  onChange={(e) => setNewTireForm(f => ({ ...f, brand: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Model *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., NFera AU7"
                  value={newTireForm.model}
                  onChange={(e) => setNewTireForm(f => ({ ...f, model: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Size (e.g., 205/55R16) *</label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="205/55R16"
                  value={newTireForm.size}
                  onChange={(e) => setNewTireForm(f => ({ ...f, size: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Wholesale Cost ($)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="54.06"
                  value={newTireForm.wholesale}
                  onChange={(e) => setNewTireForm(f => ({ ...f, wholesale: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Stock</label>
                <input
                  type="number"
                  className="input"
                  placeholder="12"
                  value={newTireForm.stock}
                  onChange={(e) => setNewTireForm(f => ({ ...f, stock: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Season</label>
                <select
                  className="input select"
                  value={newTireForm.season}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewTireForm(f => ({ ...f, season: val, includeInstall: val === 'None' ? false : (f.includeInstall ?? true) }));
                  }}
                >
                  {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <p className="text-xs text-muted mt-1">Select "None" for wheels, rims, TPMS sensors, and accessories.</p>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newTireForm.includeInstall ?? true}
                    onChange={(e) => setNewTireForm(f => ({ ...f, includeInstall: e.target.checked }))}
                  />
                  <span className="text-sm">Installation applies to this item</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!newTireForm.isFree}
                    onChange={(e) => setNewTireForm(f => ({ ...f, isFree: e.target.checked }))}
                  />
                  <span className="text-sm">Free item (price $0)</span>
                </label>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Sale Price ($) — optional</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="e.g., 59.99"
                  value={newTireForm.salePrice}
                  onChange={(e) => setNewTireForm(f => ({ ...f, salePrice: e.target.value }))}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Sale Start (optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={newTireForm.saleStart}
                    onChange={(e) => setNewTireForm(f => ({ ...f, saleStart: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Sale End (optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={newTireForm.saleEnd}
                    onChange={(e) => setNewTireForm(f => ({ ...f, saleEnd: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Distributor</label>
                <select
                  className="input select"
                  value={newTireForm.distributorId}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      const name = window.prompt('New distributor name:');
                      if (name && name.trim()) {
                        const id = onAddDistributor(name.trim());
                        if (id) setNewTireForm(f => ({ ...f, distributorId: id }));
                      }
                    } else {
                      setNewTireForm(f => ({ ...f, distributorId: e.target.value }));
                    }
                  }}
                >
                  {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  <option value="__new__">+ New distributor…</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-success flex-1" onClick={handleAddTire}>
                <Check className="w-4 h-4" />
                Add
              </button>
              <button
                className="btn btn-ghost flex-1"
                onClick={() => {
                  setShowAddModal(false);
                  setNewTireForm({
                    brand: '',
                    model: '',
                    size: '',
                    wholesale: '',
                    stock: '',
                    season: 'All-Season',
                    distributorId: 'canadaTire',
                    includeInstall: true,
                    isFree: false,
                    salePrice: '',
                    saleStart: '',
                    saleEnd: '',
                  });
                }}
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === RESULTS === */}
      {filteredTires.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No tires match your filters.</p>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-4 px-2">
          <h2 className="text-lg font-semibold">Options ({filteredTires.length})</h2>
          <div className="flex gap-2">
            <button
              className="btn btn-sm btn-success"
              onClick={addSelectedToQuote}
              disabled={selectedIds.size === 0}
              title="Add the currently selected tires to the quote"
            >
              <Plus className="w-4 h-4" />
              Add selected to quote ({selectedIds.size})
            </button>
            {selectedIds.size > 0 && (
              <button className="btn btn-sm btn-outline" onClick={() => setShowBulkEdit(v => !v)}>
                {showBulkEdit ? 'Hide Bulk Edit' : `Bulk Edit (${selectedIds.size})`}
              </button>
            )}
            <button className="btn btn-sm btn-outline" onClick={selectAllFiltered}>
              {selectedIds.size === filteredTires.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>
      )}

      {/* === BULK EDIT BAR === */}
      {showBulkEdit && selectedIds.size > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Bulk Edit — {selectedIds.size} selected</h3>
            {bulkMsg && <span className="text-xs text-success">{bulkMsg}</span>}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Distributor</label>
              <select
                className="input select w-44"
                value={bulkForm.distributorId}
                onChange={(e) => setBulkForm(f => ({ ...f, distributorId: e.target.value }))}
              >
                <option value="">— Leave unchanged —</option>
                {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Stock</label>
              <input
                type="number"
                className="input w-20"
                placeholder="Set"
                value={bulkForm.stock}
                onChange={(e) => setBulkForm(f => ({ ...f, stock: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Price (regular $)</label>
              <input
                type="number"
                step="0.01"
                className="input w-24"
                placeholder="Set"
                value={bulkForm.price}
                onChange={(e) => setBulkForm(f => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Adjust Price</label>
              <div className="flex gap-1">
                <select
                  className="input select w-24"
                  value={bulkForm.adjustMode}
                  onChange={(e) => setBulkForm(f => ({ ...f, adjustMode: e.target.value }))}
                >
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  className="input w-20"
                  placeholder="Amount"
                  value={bulkForm.adjustBy}
                  onChange={(e) => setBulkForm(f => ({ ...f, adjustBy: e.target.value }))}
                />
                <select
                  className="input select w-16"
                  value={bulkForm.adjustUnit}
                  onChange={(e) => setBulkForm(f => ({ ...f, adjustUnit: e.target.value }))}
                >
                  <option value="$">$</option>
                  <option value="%">%</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Season</label>
              <select
                className="input select w-36"
                value={bulkForm.season}
                onChange={(e) => setBulkForm(f => ({ ...f, season: e.target.value }))}
              >
                <option value="">— Leave unchanged —</option>
                {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Sale Price ($)</label>
              <input
                type="number"
                step="0.01"
                className="input w-24"
                placeholder="Set"
                value={bulkForm.salePrice}
                onChange={(e) => setBulkForm(f => ({ ...f, salePrice: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Sale Start</label>
              <input
                type="date"
                className="input w-36"
                value={bulkForm.saleStart}
                onChange={(e) => setBulkForm(f => ({ ...f, saleStart: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Sale End</label>
              <input
                type="date"
                className="input w-36"
                value={bulkForm.saleEnd}
                onChange={(e) => setBulkForm(f => ({ ...f, saleEnd: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Install</label>
              <select
                className="input select w-32"
                value={bulkForm.includeInstall}
                onChange={(e) => setBulkForm(f => ({ ...f, includeInstall: e.target.value }))}
              >
                <option value="">— Leave unchanged —</option>
                <option value="true">Included</option>
                <option value="false">Not included</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Free</label>
              <select
                className="input select w-28"
                value={bulkForm.isFree}
                onChange={(e) => setBulkForm(f => ({ ...f, isFree: e.target.value }))}
              >
                <option value="">— Leave unchanged —</option>
                <option value="true">Free ($0)</option>
                <option value="false">Paid</option>
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={bulkForm.clearSale}
                onChange={(e) => setBulkForm(f => ({ ...f, clearSale: e.target.checked }))}
              />
              <span className="text-sm">Clear sale</span>
            </label>
            <button className="btn btn-success" onClick={applyBulkEdit}>
              <Check className="w-4 h-4" />
              Apply
            </button>
            <button className="btn btn-ghost" onClick={() => setShowBulkEdit(false)}>
              <X className="w-4 h-4" />
              Close
            </button>
          </div>
        </div>
      )}

      {/* === TIRE CARDS === */}
      {filteredTires.length > 0 && (
        <div className="flex-col gap-4">
          {filteredTires.slice(0, visibleCount).map(tire => {
            const isSelected = selectedIds.has(tire.id);
            const isEditing = editingId === tire.id;
            const calc = getTireCalculations(tire);
            const installPerTire = calc.installPerTire || 0;
            const tiresSubtotal = calc.tireTotal * quantity;
            // Installation applies only to the number of tires to be installed (installQty)
            const installTotal = (showInstall && tire.includeInstall !== false) ? installPerTire * installQty : 0;
            const installTaxInclusive = installTotal * (1 + HST_RATE);
            // Travel surcharge is per job and applies only when a service visit is included
            const travelSurcharge = showInstall ? postalInfo.surcharge : 0;
            const grandTotal = tiresSubtotal + installTaxInclusive + travelSurcharge;

            const inQuote = quoteItems.some(q => q.id === tire.id);
            return (
              <div key={tire.id} className="card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={`checkbox ${isSelected ? 'checked' : ''}`}
                      onClick={() => toggleSelect(tire.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </div>
                    <div>
                      {!isEditing ? (
                        <>
                          <h3 className="font-semibold text-base">{tire.brand}</h3>
                          <p className="text-sm text-muted">{tire.model}</p>
                        </>
                      ) : (
                        <div className="flex-col gap-1">
                          <input
                            className="input text-sm"
                            value={editForm.brand || ''}
                            onChange={(e) => setEditForm(f => ({ ...f, brand: e.target.value }))}
                            placeholder="Brand"
                          />
                          <input
                            className="input text-sm"
                            value={editForm.model || ''}
                            onChange={(e) => setEditForm(f => ({ ...f, model: e.target.value }))}
                            placeholder="Model"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 items-center">
                    {inQuote && <span className="badge badge-green">In quote</span>}
                    {!isEditing ? (
                      <>
                        <button className="btn btn-sm btn-ghost p-1" onClick={() => startEdit(tire)} title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-sm btn-ghost p-1 text-danger"
                          onClick={() => {
                            if (window.confirm(`Delete ${tire.brand} ${tire.model}?`)) deleteTire(tire.id);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-success p-1" onClick={saveEdit} title="Save">
                          <Check className="w-4 h-4" />
                        </button>
                        <button className="btn btn-sm btn-ghost p-1" onClick={cancelEdit} title="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Size & Badges */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {!isEditing ? (
                    <span className="badge badge-gray font-mono">{tire.size}</span>
                  ) : (
                    <input
                      className="input text-sm w-32 font-mono"
                      value={editForm.size || ''}
                      onChange={(e) => setEditForm(f => ({ ...f, size: e.target.value }))}
                      placeholder="205/55R16"
                    />
                  )}
                  <span className={`badge badge-${
                    tire.season === 'Winter' ? 'blue' :
                    tire.season === 'All-Season' ? 'green' :
                    tire.season === 'All-Weather' ? 'purple' :
                    'yellow'
                  }`}>
                    {!isEditing ? tire.season : (
                      <select
                        className="bg-transparent border-none text-xs font-medium"
                        value={editForm.season || 'All-Season'}
                        onChange={(e) => setEditForm(f => ({ ...f, season: e.target.value }))}
                      >
                        {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                  </span>
                  <span className="badge badge-gray">{!isEditing ? tire.tier : getTierForBrand(editForm.distributorId || tire.distributorId, editForm.brand || tire.brand)}</span>
                  {!isEditing ? (
                    <span className="badge badge-gray">{tire.distributorId}</span>
                  ) : (
                    <select
                      className="input text-sm"
                      value={editForm.distributorId || ''}
                      onChange={(e) => setEditForm(f => ({ ...f, distributorId: e.target.value }))}
                    >
                      {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  )}
                  {/* Sale badge with start/end dates */}
                  {!isEditing && calc.sale.salePrice && (
                    <span className={`badge ${calc.sale.saleActive ? 'badge-yellow' : 'badge-gray'}`}>
                      {calc.sale.saleActive ? 'On Sale' : 'Sale'} {formatCurrency(calc.sale.salePrice)}
                      {calc.sale.saleStart && ` · ${calc.sale.saleStart.toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                      {calc.sale.saleEnd && ` – ${calc.sale.saleEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                    </span>
                  )}
                </div>

                {/* Stock, Wholesale, Price & Sale (edit mode) */}
                {isEditing && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    <div>
                      <span className="text-xs text-muted">Wholesale $</span>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-sm w-24"
                        value={editForm.wholesale ?? ''}
                        onChange={(e) => setEditForm(f => ({ ...f, wholesale: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="text-xs text-muted">Stock</span>
                      <input
                        type="number"
                        className="input text-sm w-20"
                        value={editForm.stock ?? ''}
                        onChange={(e) => setEditForm(f => ({ ...f, stock: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="text-xs text-muted">Regular Price $ (blank = auto)</span>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-sm w-24"
                        value={editForm.price ?? ''}
                        onChange={(e) => setEditForm(f => ({ ...f, price: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="text-xs text-muted">Sale Price $</span>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-sm w-24"
                        value={editForm.salePrice ?? ''}
                        onChange={(e) => setEditForm(f => ({ ...f, salePrice: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="text-xs text-muted">Sale Start</span>
                      <input
                        type="date"
                        className="input text-sm"
                        value={editForm.saleStart || ''}
                        onChange={(e) => setEditForm(f => ({ ...f, saleStart: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="text-xs text-muted">Sale End</span>
                      <input
                        type="date"
                        className="input text-sm"
                        value={editForm.saleEnd || ''}
                        onChange={(e) => setEditForm(f => ({ ...f, saleEnd: e.target.value }))}
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer pt-5">
                      <input
                        type="checkbox"
                        checked={editForm.includeInstall !== false}
                        onChange={(e) => setEditForm(f => ({ ...f, includeInstall: e.target.checked }))}
                      />
                      <span className="text-xs font-medium">Include installation for this item</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer pt-5">
                      <input
                        type="checkbox"
                        checked={!!editForm.isFree}
                        onChange={(e) => setEditForm(f => ({ ...f, isFree: e.target.checked }))}
                      />
                      <span className="text-xs font-medium">Free item ($0)</span>
                    </label>
                  </div>
                )}

                {/* FIXED: Price Breakdown with Installation Tax Included */}
                <div className="bg-slate-50 rounded-lg p-3 mb-3">
                  <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">Cost Breakdown (per tire)</p>

                  {/* Tire Only */}
                  <div className="price-row">
                    <span className="text-sm">Wholesale (purchase)</span>
                    <span className="text-sm font-mono">{formatCurrency(tire.wholesale)}</span>
                  </div>
                  <div className="price-row">
                    <span className="text-sm">+ Env fee</span>
                    <span className="text-sm font-mono text-success">{formatCurrency(ENV_FEE_PER_TIRE)}</span>
                  </div>
                  <div className="price-row">
                    <span className="text-sm font-medium">Purchase cost</span>
                    <span className="text-sm font-mono font-medium">{formatCurrency(calc.purchaseCost)}</span>
                  </div>
                  <div className="border-t my-1" />
                  <div className="price-row">
                    <span className="text-sm">+ Markup</span>
                    <span className="text-sm font-mono text-success">{formatCurrency(MARKUP_PER_TIRE)}</span>
                  </div>
                  <div className="price-row">
                    <span className="text-sm font-medium">
                      Tire (pre-tax)
                      {calc.sale.saleActive && <span className="text-xs text-warning ml-1">Sale!</span>}
                    </span>
                    <span className="text-sm font-mono font-medium">
                      {calc.sale.saleActive ? (
                        <>
                          <span className="line-through text-muted mr-1">{formatCurrency(calc.regularPrice)}</span>
                          {formatCurrency(calc.retailPrice)}
                        </>
                      ) : (
                        formatCurrency(calc.retailPrice)
                      )}
                    </span>
                  </div>
                  {/* When a sale is set but not active, show why the regular price applies */}
                  {calc.sale.salePrice && !calc.sale.saleActive && (
                    <div className="price-row">
                      <span className="text-xs text-muted">
                        {calc.sale.saleEnd && calc.sale.saleEnd < new Date()
                          ? `Sale ended ${calc.sale.saleEnd.toLocaleDateString()} — regular price applies`
                          : `Sale of ${formatCurrency(calc.sale.salePrice)} starts ${calc.sale.saleStart ? calc.sale.saleStart.toLocaleDateString() : 'soon'}`}
                      </span>
                    </div>
                  )}

                  {/* Installation Pre-Tax (NEW) */}
                  {showInstall && tire.includeInstall !== false && calc.installPerTire > 0 && (
                    <>
                      <div className="price-row">
                        <span className="text-sm">+ Installation (pre-tax)</span>
                        <span className="text-sm font-mono">
                          {formatCurrency(calc.installPerTire)}
                          {buyFromQuickRev && <span className="text-success text-xs ml-1">(-10%)</span>}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Combined Pre-Tax (NEW) */}
                  <div className="border-t my-1" />
                  <div className="price-row font-medium">
                    <span className="text-sm">Subtotal (before HST)</span>
                    <span className="text-sm font-mono font-bold">{formatCurrency(calc.totalPreTax)}</span>
                  </div>

                  {/* HST on Combined (NEW) */}
                  <div className="price-row">
                    <span className="text-sm">+ HST ({(HST_RATE * 100).toFixed(0)}%)</span>
                    <span className="text-sm font-mono text-warning">{formatCurrency(calc.totalHST)}</span>
                  </div>

                  {/* Final Total (FIXED) */}
                  <div className="price-row total mt-2">
                    <span>Total per tire</span>
                    <span className="text-lg font-bold text-accent">{formatCurrency(calc.totalPerTire)}</span>
                  </div>
                </div>

                {/* Quantity Totals */}
                <div className="bg-primary text-white rounded-lg p-3 mb-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm opacity-80">{quantity} tires × {formatCurrency(calc.tireTotal)}</span>
                    <span className="text-sm font-mono">{formatCurrency(tiresSubtotal)}</span>
                  </div>
                  {showInstall && installTotal > 0 && (
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm opacity-80">{installQty} install(s) × {formatCurrency(installPerTire)} (pre-tax)</span>
                      <span className="text-sm font-mono">{formatCurrency(installTaxInclusive)}</span>
                    </div>
                  )}
                  {showInstall && travelSurcharge > 0 && (
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm opacity-80">Travel surcharge (per job)</span>
                      <span className="text-sm font-mono">{formatCurrency(travelSurcharge)}</span>
                    </div>
                  )}
                  <div className="border-t border-white/20 my-1" />
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold">Total</span>
                    <span className="text-sm font-bold font-mono">{formatCurrency(grandTotal)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-xs opacity-60">{singleActiveLocation ? `Stock @ ${singleActiveLocation}: ${getTireStock(tire)}` : `Stock: ${getTireStock(tire)}`}</span>
                    <span className="text-xs opacity-60">Tires: {formatCurrency(tiresSubtotal)}{showInstall && installTotal > 0 ? ` + Install: ${formatCurrency(installTaxInclusive)}` : ''}{showInstall && travelSurcharge > 0 ? ` + Travel: ${formatCurrency(travelSurcharge)}` : ''}</span>
                  </div>
                  {/* Expandable per-warehouse stock breakdown */}
                  {(tire.inventory || []).length > 0 && (
                    <div className="mt-1">
                      <button
                        className="text-xs underline opacity-70"
                        onClick={() => setExpandedStockId(expandedStockId === tire.id ? null : tire.id)}
                      >
                        {expandedStockId === tire.id ? 'Hide' : 'Show'} stock by location ▾
                      </button>
                      {expandedStockId === tire.id && (
                        <div className="mt-1">
                          {tire.inventory.map(loc => (
                            <div key={loc.location} className="flex justify-between text-xs opacity-70 py-0.5">
                              <span>{loc.location}</span>
                              <span className="font-mono">{loc.quantity}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 items-center">
                  <button className="btn btn-secondary flex-1 btn-sm" onClick={() => copyQuote(tire)}>
                    <Download className="w-4 h-4" />
                    Copy Text
                  </button>
                  {copiedId === tire.id && <span className="text-xs text-success">Copied!</span>}
                </div>
              </div>
            );
          })}
          {filteredTires.length > visibleCount && (
            <button
              className="btn btn-outline w-full"
              onClick={() => setVisibleCount(c => c + 100)}
            >
              Show more ({filteredTires.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}