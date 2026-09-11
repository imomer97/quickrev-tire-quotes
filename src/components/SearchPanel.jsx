import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { resizeImageFile } from '../utils/imageResize';
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
  CATEGORIES,
  CATEGORY_KEYS,
  getCategory,
  isSeasonApplicable,
  calculatePurchaseCost,
  calculateInstallationPerTire,
  parseTireSize,
  parseWheelSize,
  formatSize,
  formatCurrency,
  ENV_FEE_PER_TIRE,
  MARKUP_PER_TIRE,
  HST_RATE,
  getTierForBrand,
  getRegularPrice,
  getSaleInfo,
  getEffectiveRetail,
  resolvePostalCode,
  TPMS_PROGRAM_FEE,
  isTpmsItem,
  getInstallFeeForItem,
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
  // Category filter: all categories shown by default
  const [activeCategories, setActiveCategories] = useState(new Set(CATEGORY_KEYS));
  // Show only items with stock ≥ this many; defaults to the quote quantity so
  // out-of-stock-for-this-job items stay hidden automatically.
  const [minStock, setMinStock] = useState(quantity);
  // Hide out-of-stock items ("In stock only").
  const [inStockOnly, setInStockOnly] = useState(false);
  // Wheel bolt-pattern chips (e.g. "6X132 74.5MM", "5X114.3", "SPLINE DEEP")
  const [activeBoltPatterns, setActiveBoltPatterns] = useState(new Set());
  // Wheel diameter filter (e.g. "17", "20") in inches
  const [activeDiameters, setActiveDiameters] = useState(new Set());
  // Wheel width filter (e.g. 7, 7.5, 8.5) in inches
  const [activeWidths, setActiveWidths] = useState(new Set());
  const [showBoltPatternInput, setShowBoltPatternInput] = useState(false);
  const [boltPatternInput, setBoltPatternInput] = useState('');
  // Free-text fitment tags (e.g. "2019 Escape", "MiniSuv", "M14X1.5")
  const [activeFitments, setActiveFitments] = useState(new Set());
  const [showFitmentInput, setShowFitmentInput] = useState(false);
  const [fitmentInput, setFitmentInput] = useState('');
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
  const [quoteItems, setQuoteItems] = useState(() => {
    // Restore the quote after a reload — items were chosen deliberately
    try {
      const stored = JSON.parse(localStorage.getItem('quickrev_quote_items') || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch { return []; }
  });
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
    category: '',
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
  const [showInstallServiceModal, setShowInstallServiceModal] = useState(false);
  const [installServiceForm, setInstallServiceForm] = useState(null);
  const [newTireForm, setNewTireForm] = useState({
    brand: '',
    model: '',
    size: '',
    category: 'tire',
    fitment: '',
    image: null,
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

  const toggleCategory = (cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleBoltPattern = (bp) => {
    setActiveBoltPatterns(prev => {
      const next = new Set(prev);
      if (next.has(bp)) next.delete(bp);
      else next.add(bp);
      return next;
    });
  };

  const toggleDiameter = (d) => {
    setActiveDiameters(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const toggleWheelWidth = (w) => {
    setActiveWidths(prev => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });
  };

  const toggleFitment = (f) => {
    setActiveFitments(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
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

  // Distinct bolt-patterns and fitment tags across the current catalog, for the
  // filter chips. These update when the catalog changes so the chip list stays
  // fresh without scanning the full catalog on every render.
  const boltPatterns = useMemo(
    () => [...new Set(tires.filter(t => getCategory(t) === 'wheel').map(t => (t.size || '').toUpperCase()).filter(Boolean))].sort(),
    [tires]
  );
  // Distinct wheel diameters (inches), sorted numerically
  const wheelDiameters = useMemo(
    () => [...new Set(
      tires.filter(t => getCategory(t) === 'wheel')
        .map(t => parseWheelSize(t.size))
        .filter(w => w && w.diameter != null)
        .map(w => w.diameter)
    )].sort((a, b) => a - b),
    [tires]
  );
  // Distinct wheel widths (inches, e.g. 7.5), sorted numerically
  const wheelWidths = useMemo(
    () => [...new Set(
      tires.filter(t => getCategory(t) === 'wheel')
        .map(t => parseWheelSize(t.size))
        .filter(w => w && w.width != null)
        .map(w => w.width)
    )].sort((a, b) => a - b),
    [tires]
  );
  const fitments = useMemo(
    () => [...new Set(tires.map(t => t.fitment || '').filter(Boolean).sort())],
    [tires]
  );

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
      // Distributor — general options plus per-warehouse Canada Tire options.
      // When NO distributor is selected, search globally across all of them
      // (results show where each item lives) instead of returning nothing.
      const noDistributorSelected = activeDistributors.size === 0;
      const distMatch = noDistributorSelected
        || activeDistributors.has(tire.distributorId)
        || (tire.distributorId === 'canadaTire' && [...activeDistributors].some(id =>
            id.startsWith('ct:') && (tire.inventory || []).some(l => l.location === id.slice(3))));
      if (!distMatch) return false;
      // Tier — same global rule: no tiers selected means show everything
      if (activeTiers.size > 0 && !activeTiers.has(tire.tier)) return false;
      // Season — only tires carry a season; wheels/parts skip this filter
      if (isSeasonApplicable(tire) && activeSeasons.size > 0 && !activeSeasons.has(tire.season)) return false;
      // Category — none selected shows everything, same global rule
      if (activeCategories.size > 0 && !activeCategories.has(getCategory(tire))) return false;
      // Wheel bolt-pattern filter (only meaningful for wheels; for tires it's a
      // no-op so tire results aren't hidden).
      if (getCategory(tire) === 'wheel' && activeBoltPatterns.size > 0) {
        const tBp = String(tire.size || '').toUpperCase();
        const hit = [...activeBoltPatterns].some(bp => tBp.includes(bp));
        if (!hit) return false;
      }
      // Wheel diameter filter — parse the wheel size and match its diameter in
      // inches. Only applies to wheels, so tire results are never hidden.
      if (getCategory(tire) === 'wheel' && activeDiameters.size > 0) {
        const w = parseWheelSize(tire.size);
        if (!w || w.diameter == null || !activeDiameters.has(w.diameter)) return false;
      }
      // Wheel width filter — same rule: wheels only (e.g. 7, 7.5, 8.5 inches).
      if (getCategory(tire) === 'wheel' && activeWidths.size > 0) {
        const w = parseWheelSize(tire.size);
        if (!w || w.width == null || !activeWidths.has(w.width)) return false;
      }
      // Vehicle fitment filter — free-text, matches against size, brand, model,
      // and a dedicated fitment string if the item carries one.
      if (activeFitments.size > 0) {
        const haystack = [tire.size, tire.brand, tire.model, tire.fitment || '']
          .join(' ').toLowerCase();
        const hit = [...activeFitments].some(f => haystack.includes(f.toLowerCase()));
        if (!hit) return false;
      }
      // Availability: skip out-of-stock when the user asked for it, and skip items
      // whose stock is below the minimum the quote requires (so e.g. a 4-tire job
      // won't show a wheel with only 2 in stock).
      if (inStockOnly && getTireStock(tire) === 0) return false;
      if (getTireStock(tire) < minStock) return false;
      return true;
    });

    // Sort (pre-tax total based on the effective price, so sales affect order)
    results = [...results].sort((a, b) => {
      const aParsed = parseTireSize(a.size) || parseWheelSize(a.size);
      const bParsed = parseTireSize(b.size) || parseWheelSize(b.size);
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
  }, [tires, searchSize, activeDistributors, activeTiers, activeSeasons, activeCategories, activeBoltPatterns, activeDiameters, activeWidths, activeFitments, inStockOnly, minStock, sortBy, showInstall, vehicleType, buyFromQuickRev, getTireStock, getEffectiveRetail]);

  function getTireCalculations(tire) {
    // Service line items (installation-only quotes) price as one job from
    // their stored price — no size parsing or install math applies.
    if (getCategory(tire) === 'service') {
      const price = parseFloat(tire.price) || 0;
      const hstS = price * HST_RATE;
      return {
        purchaseCost: 0,
        retailPrice: price,
        regularPrice: price,
        hst: hstS,
        tireTotal: price + hstS,
        sale: { saleActive: false },
        installPerTire: 0,
        totalPreTax: price,
        totalHST: hstS,
        totalPerTire: price + hstS,
        category: 'service',
        envFee: 0,
      };
    }
    const parsed = parseTireSize(tire.size) || parseWheelSize(tire.size);
    const retailPrice = getEffectiveRetail(tire);
    const hst = retailPrice * HST_RATE;
    const tireTotal = retailPrice + hst;
    const sale = getSaleInfo(tire);
    const tpms = isTpmsItem(tire);

    if (!parsed && !tpms) {
      return {
        purchaseCost: calculatePurchaseCost(tire.wholesale, tire),
        retailPrice,
        regularPrice: getRegularPrice(tire),
        hst,
        tireTotal,
        sale,
        installPerTire: 0,
        totalPreTax: retailPrice,
        totalHST: hst,
        totalPerTire: tireTotal,
        category: getCategory(tire),
        envFee: getCategory(tire) === 'tire' ? ENV_FEE_PER_TIRE : 0,
      };
    }

    const installEligible = showInstall && tire.includeInstall !== false && (tpms || parsed);
    const installPerTire = installEligible
      ? getInstallFeeForItem(tire, parsed, vehicleType, buyFromQuickRev)
      : 0;
    // Combined pre-tax (tire at effective price + installation), HST on both
    const preTax = installEligible ? retailPrice + installPerTire : retailPrice;
    const totalHST = preTax * HST_RATE;

    return {
      purchaseCost: calculatePurchaseCost(tire.wholesale, tire),
      retailPrice,
      regularPrice: getRegularPrice(tire),
      hst,
      tireTotal,
      sale,
      installPerTire,
      totalPreTax: preTax,
      totalHST,
      totalPerTire: preTax + totalHST,
      category: getCategory(tire),
      envFee: getCategory(tire) === 'tire' ? ENV_FEE_PER_TIRE : 0,
    };
  }

  // === EDIT HANDLERS ===
  const startEdit = (tire) => {
    setEditingId(tire.id);
    setEditForm({ ...tire });
    // The card swaps badges for edit inputs, which shifts content. Bring the
    // edited card into view so the edit form is actually visible — without
    // this, clicking Edit on a card lower down the page looks like a no-op.
    requestAnimationFrame(() => {
      document.getElementById(`item-card-${tire.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
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
      category: editForm.category || 'tire',
      fitment: (editForm.fitment || '').trim() || null,
      wholesale: parseFloat(editForm.wholesale) || 0,
      markupOverride: (editForm.markupOverride === '' || editForm.markupOverride == null) ? null : parseFloat(editForm.markupOverride) || null,
      installFee: (editForm.installFee === '' || editForm.installFee == null) ? null : parseFloat(editForm.installFee) || null,
      stock: parseInt(editForm.stock, 10) || 0,
      season: editForm.season,
      distributorId,
      tier: getTierForBrand(distributorId, editForm.brand),
      price,
      salePrice,
      saleStart: editForm.saleStart || null,
      saleEnd: editForm.saleEnd || null,
      image: editForm.image || null,
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

  // Predictable select/deselect: if ANY items are selected the button clears
  // them; otherwise it selects everything visible. The old rule (compare
  // selection size to result count) made deselect impossible unless the
  // selection exactly matched the results — clicking then ADDED to the
  // selection, which read as "deselect all isn't working".
  const toggleSelectAll = () => {
    if (selectedIds.size > 0) {
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
    if (bulkForm.category) updates.category = bulkForm.category;
    // Increase / decrease the price (regular, pre-tax) by an amount or percentage
    if (bulkForm.adjustBy !== '') {
      const amt = parseFloat(bulkForm.adjustBy) || 0;
      if (amt !== 0) updates.priceAdjust = { mode: bulkForm.adjustMode, amount: amt, unit: bulkForm.adjustUnit };
    }
    if (Object.keys(updates).length === 0) return;
    bulkUpdateTires(ids, updates);
    setBulkMsg(`Applied to ${ids.length} item(s)`);
    setTimeout(() => setBulkMsg(null), 2500);
    setBulkForm({
      distributorId: '', stock: '', price: '', adjustMode: 'increase', adjustBy: '', adjustUnit: '$',
      season: '', salePrice: '', saleStart: '', saleEnd: '', clearSale: false,
      includeInstall: '', isFree: '', category: '',
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
      category: newTireForm.category || 'tire',
      fitment: (newTireForm.fitment || '').trim() || undefined,
      image: newTireForm.image || undefined,
      wholesale: parseFloat(newTireForm.wholesale) || 0,
      stock: parseInt(newTireForm.stock, 10) || 0,
      season: newTireForm.category && newTireForm.category !== 'tire' ? 'None' : (newTireForm.season || 'All-Season'),
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
      image: null,
    });
    setShowAddModal(false);
  };

  // === QUOTE HANDLERS ===
  // Moves the currently selected search results into the persistent quote,
  // then clears the transient selection so the user can search again.
  // Each quote line carries its own quantity (defaulting to the global
  // "number of tires" field) so mixed quotes — e.g. 4 tires + 2 brake kits —
  // price correctly.
  const addSelectedToQuote = () => {
    if (selectedIds.size === 0) return;
    const items = filteredTires.filter(t => selectedIds.has(t.id));
    setQuoteItems(prev => {
      const seen = new Set(prev.map(i => i.id));
      const toAdd = items.filter(t => !seen.has(t.id)).map(t => ({ ...t, quoteQty: quantity }));
      return [...prev, ...toAdd];
    });
    setSelectedIds(new Set());
  };

  // Selection is tied to what's on screen: when the filter/search results
  // change, drop any selected ids that are no longer visible. Otherwise the
  // "Add selected (N)" button counts hidden items and clicking it appears
  // to do nothing — the classic "selection is broken" report.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredTires.map(t => t.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredTires]);

  // Persist the quote across reloads — a lost quote reads as "my work vanished".
  const QUOTE_STORAGE_KEY = 'quickrev_quote_items';
  useEffect(() => {
    try {
      localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(quoteItems));
    } catch { /* storage full or unavailable — quote just won't persist */ }
  }, [quoteItems]);

  const removeFromQuote = (id) => {
    setQuoteItems(prev => prev.filter(i => i.id !== id));
  };

  // Add a single item straight from its product card — no need to tick the
  // checkbox and scroll up to the "Add selected to quote" button.
  const addOneToQuote = (tire) => {
    setQuoteItems(prev => {
      if (prev.some(i => i.id === tire.id)) return prev;
      return [...prev, { ...tire, quoteQty: quantity }];
    });
  };

  const setQuoteItemQty = (id, qty) => {
    const q = Math.max(1, parseInt(qty, 10) || 1);
    setQuoteItems(prev => prev.map(i => i.id === id ? { ...i, quoteQty: q } : i));
  };

  /**
   * Quote the installation service on its own — for customers supplying their
   * own tires (who may still buy wheels, TPMS, etc.). Opens a popup prefilled
   * from the tire installation calculator so the rate/count/travel can be
   * tweaked first.
   */
  const openInstallServiceModal = () => {
    if (!vehicleType) {
      alert('Select a vehicle type first — the installation rate depends on it.');
      return;
    }
    const parsed = parseTireSize(searchSize || pdfTireSize);
    const autoPerTire = calculateInstallationPerTire(
      parsed ? parsed.width : 0,
      parsed ? parsed.aspect : 0,
      parsed ? parsed.rim : 0,
      vehicleType,
      buyFromQuickRev
    );
    setInstallServiceForm({
      serviceName: 'Installation Service',
      perTire: autoPerTire.toFixed(2),
      qty: installQty > 0 ? installQty : quantity,
      unit: 'tire',
      sizeLabel: (searchSize || pdfTireSize || 'customer tires').toUpperCase(),
      vehicleLabel: VEHICLE_LABELS[vehicleType] || vehicleType,
      discounted: buyFromQuickRev,
      // Default the travel surcharge to the current postal-code lookup
      travel: postalInfo.surcharge || 0,
    });
    setShowInstallServiceModal(true);
  };

  const confirmInstallService = () => {
    const perTire = parseFloat(installServiceForm.perTire) || 0;
    const qty = Math.max(1, parseInt(installServiceForm.qty, 10) || 1);
    const travel = Math.max(0, parseFloat(installServiceForm.travel) || 0);
    const sizeLabel = (installServiceForm.sizeLabel || 'customer tires').toUpperCase();
    // Unit describes what the rate applies to — "tire" for installs, but the
    // popup is generic ("axle", "hour", "brake job"…) for other services.
    const unit = (installServiceForm.unit || 'tire').trim().toLowerCase() || 'tire';
    const serviceItem = {
      id: `service-install-${Date.now()}`,
      category: 'service',
      brand: 'QuickRev',
      model: installServiceForm.serviceName || 'Installation Service',
      // Whole visit in one line: labor + travel surcharge. Services are
      // quoted as one line, not per unit.
      price: +(perTire * qty + travel).toFixed(2),
      size: `${sizeLabel} · ${qty} ${unit}${qty === 1 ? '' : 's'}${travel > 0 ? ` · travel ${formatCurrency(travel)}` : ''}`,
      season: 'None',
      tier: 'service',
      stock: 1,
      includeInstall: false,
      isService: true,
      serviceQty: qty,
      servicePerUnit: +perTire.toFixed(2),
      serviceUnit: unit,
      serviceDesc: installServiceForm.serviceName || 'installation',
      serviceTravel: travel,
      _transient: true,
    };
    setQuoteItems(prev => [...prev, serviceItem]);
    setManualQuoteOrder(true);
    setShowInstallServiceModal(false);
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
      // Per-line quantity (falls back to the global field for legacy quote items)
      quantityFor: (item) => (item && typeof item.quoteQty === 'number' && item.quoteQty > 0) ? item.quoteQty : quantity,
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
              title="Add a new item manually (tire, wheel, or part)"
            >
              <Plus className="w-4 h-4" />
              Add Item
            </button>
            <button
              className="btn btn-primary"
              onClick={openInstallServiceModal}
              disabled={!vehicleType}
              title="Quote the installation service by itself (customer's own tires) — uses the installation calculator"
            >
              <Wrench className="w-4 h-4" />
              Install Service
            </button>
          </div>

          {/* === SEARCH HELP TEXT === */}
          <p className="text-xs text-muted ml-1">
            💡 Search by size (205/55R16, 20555R16, or 2055516), brand, or model. Filter by wheel bolt pattern and vehicle fitment, stock, and category below.
          </p>

          {/* === PDF SIZE FIELD === */}
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Item Size (PDF)</label>
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
            {/* Availability filter — hides out-of-stock items and those short of the
                minimum the quote requires. */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-muted uppercase">Availability</p>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">In stock only</span>
                </label>
                <div>
                  <label className="text-xs font-medium text-muted" htmlFor="minStock">Min. stock (for quote)</label>
                  <input
                    type="number"
                    id="minStock"
                    className="input w-20"
                    placeholder="Qty"
                    min="0"
                    max="20"
                    value={minStock}
                    onChange={(e) => setMinStock(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
              </div>
            </div>

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
              <p className="text-xs font-semibold text-muted mb-2 uppercase">Category</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CATEGORIES).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeCategories.has(key)}
                      onChange={() => toggleCategory(key)}
                      className="rounded"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted mb-2 uppercase">Wheel Bolt Pattern</p>
              <div className="flex flex-wrap gap-2">
                {boltPatterns.map(bp => (
                  <button
                    key={bp}
                    type="button"
                    onClick={() => toggleBoltPattern(bp)}
                    style={{
                      padding: '2px 10px', fontSize: '0.75rem', borderRadius: 6,
                      border: '1px solid ' + (activeBoltPatterns.has(bp) ? '#0f172a' : '#cbd5e1'),
                      background: activeBoltPatterns.has(bp) ? '#0f172a' : '#fff',
                      color: activeBoltPatterns.has(bp) ? '#fff' : '#334155',
                      fontFamily: 'monospace', cursor: 'pointer',
                    }}
                  >
                    {bp}
                  </button>
                ))}
                {boltPatterns.length === 0 && (
                  <span className="text-xs text-muted">No wheels in the catalog yet — add wheels to see their bolt patterns here.</span>
                )}
              </div>
              {wheelDiameters.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-muted mb-2 uppercase">Diameter (inches)</p>
                  <div className="flex flex-wrap gap-2">
                    {wheelDiameters.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDiameter(d)}
                        style={{
                          padding: '2px 10px', fontSize: '0.75rem', borderRadius: 6,
                          border: '1px solid ' + (activeDiameters.has(d) ? '#0f172a' : '#cbd5e1'),
                          background: activeDiameters.has(d) ? '#0f172a' : '#fff',
                          color: activeDiameters.has(d) ? '#fff' : '#334155',
                          fontFamily: 'monospace', cursor: 'pointer',
                        }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {wheelWidths.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-muted mb-2 uppercase">Width (inches)</p>
                  <div className="flex flex-wrap gap-2">
                    {wheelWidths.map(wd => (
                      <button
                        key={wd}
                        type="button"
                        onClick={() => toggleWheelWidth(wd)}
                        style={{
                          padding: '2px 10px', fontSize: '0.75rem', borderRadius: 6,
                          border: '1px solid ' + (activeWidths.has(wd) ? '#0f172a' : '#cbd5e1'),
                          background: activeWidths.has(wd) ? '#0f172a' : '#fff',
                          color: activeWidths.has(wd) ? '#fff' : '#334155',
                          fontFamily: 'monospace', cursor: 'pointer',
                        }}
                      >
                        {wd}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted mb-2 uppercase">Vehicle Fitment</p>
              <div className="flex flex-wrap gap-2 items-center">
                {fitments.map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFitment(f)}
                    style={{
                      padding: '2px 10px', fontSize: '0.75rem', borderRadius: 6,
                      border: '1px solid ' + (activeFitments.has(f) ? '#3b82f6' : '#cbd5e1'),
                      background: activeFitments.has(f) ? '#3b82f6' : '#fff',
                      color: activeFitments.has(f) ? '#fff' : '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    {f}
                  </button>
                ))}
                <input
                  className="input text-xs w-44"
                  placeholder="Fitment e.g. 2019 Escape — Enter"
                  value={fitmentInput}
                  onChange={(e) => setFitmentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && fitmentInput.trim()) {
                      toggleFitment(fitmentInput.trim());
                      setFitmentInput('');
                    }
                  }}
                />
                {(activeBoltPatterns.size > 0 || activeDiameters.size > 0 || activeWidths.size > 0 || activeFitments.size > 0) && (
                  <button
                    type="button"
                    className="text-xs text-danger font-medium"
                    onClick={() => { setActiveBoltPatterns(new Set()); setActiveDiameters(new Set()); setActiveWidths(new Set()); setActiveFitments(new Set()); }}
                  >
                    Clear fitment filters
                  </button>
                )}
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
                        {item.isService
                          ? `One job · ${formatCurrency(qCalc.tireTotal)}`
                          : `${item.quoteQty ?? quantity} × ${formatCurrency(qCalc.tireTotal)} = ${formatCurrency(qCalc.tireTotal * (item.quoteQty ?? quantity))}`}
                      </span>
                    </div>
                    {/* Per-item quantity — mixed quotes need different counts per line */}
                    {!item.isService && (
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="input text-sm w-16"
                        title="Quantity for this item"
                        aria-label={`Quantity of ${item.brand} ${item.model}`}
                        value={item.quoteQty ?? quantity}
                        onChange={(e) => setQuoteItemQty(item.id, e.target.value)}
                      />
                    )}
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

      {/* === INSTALL SERVICE MODAL === */}
      {showInstallServiceModal && installServiceForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h2 className="text-lg font-bold mb-1">Installation Service</h2>
            <p className="text-xs text-muted mb-4">
              {installServiceForm.vehicleLabel}
              {installServiceForm.discounted ? ' · 10% discount applied' : ' · no discount'}
              {' — edit before adding to the quote.'}
            </p>
            <div className="flex-col gap-3 mb-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Service name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Installation Service, Brake Job"
                  value={installServiceForm.serviceName || 'Installation Service'}
                  onChange={(e) => setInstallServiceForm(f => ({ ...f, serviceName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Size / Description</label>
                <input
                  type="text"
                  className="input"
                  value={installServiceForm.sizeLabel}
                  onChange={(e) => setInstallServiceForm(f => ({ ...f, sizeLabel: e.target.value }))}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Rate per unit ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={installServiceForm.perTire}
                    onChange={(e) => setInstallServiceForm(f => ({ ...f, perTire: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Units</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={installServiceForm.qty}
                    onChange={(e) => setInstallServiceForm(f => ({ ...f, qty: e.target.value }))}
                  />
                </div>
                <div className="w-28">
                  <label className="text-sm font-medium mb-1 block">Unit name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="tire, axle, hour…"
                    value={installServiceForm.unit || 'tire'}
                    onChange={(e) => setInstallServiceForm(f => ({ ...f, unit: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Travel surcharge ($, per job)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={installServiceForm.travel ?? 0}
                  onChange={(e) => setInstallServiceForm(f => ({ ...f, travel: e.target.value }))}
                />
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-sm flex justify-between font-medium">
                <span>Job total (pre-tax, incl. travel)</span>
                <span className="font-mono">{formatCurrency(
                  (parseFloat(installServiceForm.perTire) || 0) * (parseInt(installServiceForm.qty, 10) || 0) +
                  (Math.max(0, parseFloat(installServiceForm.travel) || 0))
                )}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-success flex-1" onClick={confirmInstallService}>
                <Check className="w-4 h-4" />
                Add to Quote
              </button>
              <button className="btn btn-ghost flex-1" onClick={() => setShowInstallServiceModal(false)}>
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === ADD TIRE MODAL === */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add Item</h2>
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
                <label className="text-sm font-medium mb-1 block">Category *</label>
                <select
                  className="input select"
                  value={newTireForm.category || 'tire'}
                  onChange={(e) => {
                    const cat = e.target.value;
                    setNewTireForm(f => ({
                      ...f,
                      category: cat,
                      // Non-tire items have no season and default install off
                      ...(cat !== 'tire' ? { season: 'None', includeInstall: false } : { season: 'All-Season' }),
                    }));
                  }}
                >
                  {Object.entries(CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {newTireForm.category === 'wheel' ? 'Size (e.g., 22X9.5 6X132 74.5MM)' : newTireForm.category === 'part' ? 'Part / Fitment (e.g., M14X1.5, 2019 Escape)' : 'Size (e.g., 205/55R16)'} *
                </label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder={newTireForm.category === 'wheel' ? '22X9.5 6X132' : newTireForm.category === 'part' ? 'Part number or fitment' : '205/55R16'}
                  value={newTireForm.size}
                  onChange={(e) => setNewTireForm(f => ({ ...f, size: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Vehicle Fitment (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., 2019-2023 Escape, MiniSuv, 6-lug GM"
                  value={newTireForm.fitment || ''}
                  onChange={(e) => setNewTireForm(f => ({ ...f, fitment: e.target.value }))}
                />
                <p className="text-xs text-muted mt-1">Shown on the PDF and searchable in the Vehicle Fitment filter.</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Image (optional)</label>
                <div className="flex items-center gap-3">
                  {newTireForm.image ? (
                    <img src={newTireForm.image} alt="" className="w-14 h-14 object-cover rounded border border-slate-200" />
                  ) : (
                    <div className="w-14 h-14 rounded border border-dashed border-slate-300 flex items-center justify-center text-slate-300">
                      <Info className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      className="input text-xs"
                      onChange={async (e) => {
                        const file = e.target.files && e.target.files[0];
                        if (!file) return;
                        try {
                          const dataUrl = await resizeImageFile(file);
                          setNewTireForm(f => ({ ...f, image: dataUrl }));
                        } catch (err) {
                          alert('Could not load image: ' + err.message);
                        }
                      }}
                    />
                    <input
                      type="text"
                      className="input text-xs mt-1"
                      placeholder="…or paste an image URL"
                      value={(newTireForm.image || '').startsWith('data:') ? '' : (newTireForm.image || '')}
                      onChange={(e) => setNewTireForm(f => ({ ...f, image: e.target.value.trim() || null }))}
                    />
                    {newTireForm.image ? (
                      <button type="button" className="text-xs text-danger mt-1" onClick={() => setNewTireForm(f => ({ ...f, image: null }))}>Remove image</button>
                    ) : null}
                  </div>
                </div>
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
              {(newTireForm.category || 'tire') === 'tire' && (
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
              )}
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
                    category: 'tire',
                    fitment: '',
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
            <button
              className="btn btn-sm btn-outline"
              onClick={toggleSelectAll}
              title={selectedIds.size > 0 ? 'Clear the current selection' : 'Select every item in the current results'}
            >
              {selectedIds.size > 0 ? `Deselect All (${selectedIds.size})` : 'Select All'}
            </button>
          </div>
        </div>
      )}

      {/* === BULK EDIT BAR === */}
      {showBulkEdit && selectedIds.size > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Bulk Edit — {selectedIds.size} item(s) selected</h3>
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
              <label className="text-xs font-semibold text-muted mb-1 block uppercase">Category</label>
              <select
                className="input select w-32"
                value={bulkForm.category}
                onChange={(e) => setBulkForm(f => ({ ...f, category: e.target.value }))}
              >
                <option value="">— Leave unchanged —</option>
                {Object.entries(CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
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
              <div key={tire.id} id={`item-card-${tire.id}`} className="card p-4">
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
                    {/* Item image thumbnail — always visible so staff recognize the part at a glance */}
                    {!isEditing && tire.image ? (
                      <img
                        src={tire.image}
                        alt={`${tire.brand} ${tire.model}`}
                        className="w-12 h-12 object-cover rounded border border-slate-200 flex-shrink-0"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : null}
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
                  {/* Category badge — leads the row so the customer can scan tires vs.
                      wheels/rims vs. parts at a glance. Absent/legacy items render as "Tire". */}
                  <span className={`badge badge-category-${getCategory(tire)}`}>
                    {CATEGORIES[getCategory(tire)]}
                  </span>
                  {!isEditing ? (
                    <span className="badge badge-gray font-mono">{formatSize(tire.size, tire)}</span>
                  ) : (
                    <input
                      className="input text-sm w-32 font-mono"
                      value={editForm.size || ''}
                      onChange={(e) => setEditForm(f => ({ ...f, size: e.target.value }))}
                      placeholder="205/55R16"
                    />
                  )}
                  {/* Fitment tag — editable inline, shown on the PDF for wheels/parts */}
                  {!isEditing ? (
                    tire.fitment ? <span className="badge badge-gray" title="Vehicle fitment">{tire.fitment}</span> : null
                  ) : (
                    <input
                      className="input text-sm w-40"
                      value={editForm.fitment || ''}
                      onChange={(e) => setEditForm(f => ({ ...f, fitment: e.target.value }))}
                      placeholder="Fitment e.g. 2019 Escape"
                    />
                  )}
                  {/* Item image — preview thumbnail in edit mode, editor when adding */}
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      {editForm.image ? (
                        <img src={editForm.image} alt="" className="w-10 h-10 object-cover rounded border border-slate-200" />
                      ) : null}
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          className="input text-xs"
                          onChange={async (e) => {
                            const file = e.target.files && e.target.files[0];
                            if (!file) return;
                            try {
                              const dataUrl = await resizeImageFile(file);
                              setEditForm(f => ({ ...f, image: dataUrl }));
                            } catch (err) {
                              alert('Could not load image: ' + err.message);
                            }
                          }}
                        />
                        <input
                          type="text"
                          className="input text-xs mt-1 w-44"
                          placeholder="…or paste an image URL"
                          value={(editForm.image || '').startsWith('data:') ? '' : (editForm.image || '')}
                          onChange={(e) => setEditForm(f => ({ ...f, image: e.target.value.trim() || null }))}
                        />
                        {editForm.image ? (
                          <button type="button" className="text-xs text-danger block mt-1" onClick={() => setEditForm(f => ({ ...f, image: null }))}>Remove image</button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
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
                  {/* Override badges — per-item custom markup / install fee are
                      visible at a glance without opening edit mode */}
                  {!isEditing && tire.markupOverride != null && (
                    <span className="badge badge-yellow" title="Custom markup set on this item">
                      Custom markup {formatCurrency(tire.markupOverride)}
                    </span>
                  )}
                  {!isEditing && tire.installFee != null && (
                    <span className="badge badge-yellow" title="Custom installation fee set on this item">
                      Custom install {formatCurrency(tire.installFee)}
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
                      <span className="text-xs text-muted">Markup $ (blank = default)</span>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-sm w-24"
                        value={editForm.markupOverride ?? ''}
                        onChange={(e) => setEditForm(f => ({ ...f, markupOverride: e.target.value }))}
                        placeholder={getCategory(tire) === 'tire' ? String(MARKUP_PER_TIRE) : '0'}
                      />
                    </div>
                    <div>
                      <span className="text-xs text-muted">Install fee $ (blank = auto)</span>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-sm w-24"
                        value={editForm.installFee ?? ''}
                        onChange={(e) => setEditForm(f => ({ ...f, installFee: e.target.value }))}
                        placeholder="Auto"
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
                  <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">Cost Breakdown (per item)</p>

                  {/* Tire Only */}
                  <div className="price-row">
                    <span className="text-sm">Wholesale (purchase)</span>
                    <span className="text-sm font-mono">{formatCurrency(tire.wholesale)}</span>
                  </div>
                  {calc.envFee > 0 && (
                    <div className="price-row">
                      <span className="text-sm">+ Env fee</span>
                      <span className="text-sm font-mono text-success">{formatCurrency(calc.envFee)}</span>
                    </div>
                  )}
                  <div className="price-row">
                    <span className="text-sm font-medium">Purchase cost</span>
                    <span className="text-sm font-mono font-medium">{formatCurrency(calc.purchaseCost)}</span>
                  </div>
                  <div className="border-t my-1" />
                  {calc.category === 'tire' && (
                    <div className="price-row">
                      <span className="text-sm">+ Markup</span>
                      <span className="text-sm font-mono text-success">{formatCurrency(calc.retailPrice - calc.purchaseCost)}</span>
                    </div>
                  )}
                  <div className="price-row">
                    <span className="text-sm font-medium">
                      {calc.category === 'tire' ? 'Tire (pre-tax)' : calc.category === 'wheel' ? 'Item price (pre-tax)' : 'Part price (pre-tax)'}
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
                    <span className="text-sm opacity-80">{quantity} × {formatCurrency(calc.tireTotal)}</span>
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
                    <span className="text-xs">
                      {singleActiveLocation
                        ? `Avail @ ${singleActiveLocation}: ${getTireStock(tire)}`
                        : `Avail: ${getTireStock(tire)}`}
                      {' '}<span className={`badge ${getTireStock(tire) === 0 ? 'badge-outofstock' : 'badge-available'}`} style={{padding:'0 0.375rem'}}>
                        {getTireStock(tire) === 0 ? 'Out of stock' : 'In stock'}
                      </span>
                    </span>
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
                  <button
                    className="btn btn-primary flex-1 btn-sm"
                    onClick={() => addOneToQuote(tire)}
                    disabled={inQuote}
                    title={inQuote ? 'Already in the quote' : 'Add this item to the quote'}
                  >
                    <Plus className="w-4 h-4" />
                    {inQuote ? 'In Quote' : 'Add to Quote'}
                  </button>
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