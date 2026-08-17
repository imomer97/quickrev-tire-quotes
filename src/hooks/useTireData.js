import { useState, useEffect, useCallback, useRef } from 'react';
import { DISTRIBUTORS, getTierForBrand, SEASONS, calculateRetailPrice } from '../data/distributors.js';

const STORAGE_KEY = 'quickrev_tire_inventory';
const LOCATIONS_KEY = 'quickrev_ct_locations';
const LAST_SYNC_KEY = 'quickrev_ct_last_sync';

// Safety cap: a broad Canada Tire sync can return thousands of tires, which
// freezes the app when rendered. Import at most this many per sync; the UI
// tells the user to narrow filters (size/brand/warehouse) to get more.
const MAX_SYNC_TIRES = 6000;

// Shared cloud-sync key (must match the server's APP_SYNC_KEY; the defaults
// keep local development zero-config).
const SYNC_KEY = import.meta.env.VITE_SYNC_KEY || 'quickrev-app';

// Stable identity key for manual (non-Canada Tire) tires — used to match the
// same tire across devices and for deletion tombstones.
const manualSyncKey = (t) => `manual:${t.distributorId || ''}:${String(t.brand || '').toLowerCase()}:${String(t.model || '').toLowerCase()}:${String(t.size || '').toLowerCase()}`;

// ========== CSV NORMALIZATION ==========
const SEASON_MAP = {
  'all-season': 'All-Season',
  'winter': 'Winter',
  'all-weather': 'All-Weather',
  'all-terrain': 'All-Terrain',
};

/**
 * Normalize season to match app constants
 * Handles case-insensitive input and common variations
 */
function normalizeSeason(rawSeason) {
  if (!rawSeason) return 'All-Season';
  const normalized = SEASON_MAP[rawSeason.toLowerCase().trim()];
  if (normalized) return normalized;
  
  // Fallback: check if it's in SEASONS (exact match)
  if (SEASONS.includes(rawSeason)) return rawSeason;
  
  // Default to All-Season if unrecognized
  console.warn(`Unknown season: "${rawSeason}" — defaulting to "All-Season"`);
  return 'All-Season';
}

/**
 * Normalize distributor ID
 * Handles case-insensitive matching and variations
 */
function normalizeDistributor(rawDistributor) {
  if (!rawDistributor || rawDistributor.trim() === '') return null;
  
  const normalized = rawDistributor.toLowerCase().trim();
  
  // Check exact match first
  const dist = DISTRIBUTORS.find(d => d.id === rawDistributor);
  if (dist) return dist.id;
  
  // Check case-insensitive name match
  const byName = DISTRIBUTORS.find(d => d.name.toLowerCase() === normalized);
  if (byName) return byName.id;
  
  // Check partial match (e.g., "Canada Tire" → "canadaTire")
  if (normalized.includes('canada')) return 'canadaTire';
  if (normalized.includes('star')) return 'starTires';
  if (normalized.includes('convenient')) return 'convenient';
  
  // Return as-is if it looks like an ID, or null if unknown
  return rawDistributor.toLowerCase() === rawDistributor ? rawDistributor : null;
}

export function useTireData() {
  const [tires, setTires] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== null ? JSON.parse(stored) : [];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);
  const [warehouseLocations, setWarehouseLocations] = useState(() => {
    try {
      const stored = localStorage.getItem(LOCATIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [lastSyncAt, setLastSyncAt] = useState(() => localStorage.getItem(LAST_SYNC_KEY) || null);
  const [syncAllRunning, setSyncAllRunning] = useState(false);
  // Live progress for the header sync button, e.g.
  // { running: true, current: 2, total: 6, location: 'Toronto, ON' }
  const [syncProgress, setSyncProgress] = useState(null);
  // Guard so concurrent auto-syncs never overlap
  const syncingRef = useRef(false);

  // Cloud sync: manual tires & price/sale edits are shared across devices.
  const [cloudSyncStatus, setCloudSyncStatus] = useState('idle'); // idle | syncing | ok | error
  const hydratedRef = useRef(false);
  const pushTimerRef = useRef(null);
  const deletedKeysRef = useRef(new Set());
  const tiresRef = useRef(tires);
  tiresRef.current = tires;
  const locationsRef = useRef(warehouseLocations);
  locationsRef.current = warehouseLocations;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tires));
  }, [tires]);

  // On load, collapse duplicate Canada Tire part numbers left over from
  // per-warehouse syncs (the RESTlet returns the full catalog for every
  // location filter). Idempotent — merging already-merged data is a no-op.
  useEffect(() => {
    mergePartsByNumber();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(warehouseLocations));
  }, [warehouseLocations]);

  useEffect(() => {
    if (lastSyncAt) localStorage.setItem(LAST_SYNC_KEY, lastSyncAt);
  }, [lastSyncAt]);

  // Check Canada Tire API proxy health
  const checkApiHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setApiStatus(data);
      return data;
    } catch (err) {
      console.error('API health check failed:', err);
      setApiStatus({ status: 'error', error: err.message });
      return { status: 'error', error: err.message };
    }
  }, []);

  // Merge warehouse locations into the persistent list
  const addWarehouseLocations = useCallback((locs) => {
    if (!locs?.length) return;
    setWarehouseLocations(prev => [...new Set([...prev, ...locs])].sort());
  }, []);

  // Fetch the warehouse list from the API (broad catalog search)
  const fetchWarehouseLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/canada-tire/locations');
      const data = await res.json();
      if (data.success && data.locations?.length) {
        addWarehouseLocations(data.locations);
        return data.locations;
      }
      return [];
    } catch (err) {
      console.error('Failed to load warehouse locations:', err);
      return [];
    }
  }, [addWarehouseLocations]);

  // Sync tires from Canada Tire API. When a `location` filter is supplied the
  // returned tires are tagged with that warehouse, and only previously-synced
  // tires from the same warehouse are replaced — so syncing warehouse-by-
  // warehouse merges cleanly instead of wiping other warehouses.
  const syncCanadaTire = useCallback(async (filters) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/canada-tire/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });

      if (!res.ok) {
        const text = await res.text();
        setIsLoading(false);
        const friendly = text.includes('INVALID_LOGIN_ATTEMPT')
          ? 'Canada Tire is throttling requests right now. Wait a minute or two, then try again.'
          : null;
        return { success: false, error: friendly || `HTTP ${res.status}: ${text || res.statusText}` };
      }

      const data = await res.json();

      if (!data.success) {
        setIsLoading(false);
        // Surface the real error from NetSuite (message or errorMsg) so users can diagnose
        const err = data.error?.message || data.error?.errorMsg || (typeof data.error === 'string' ? data.error : null) || 'API request failed';
        const friendly = err.includes('INVALID_LOGIN_ATTEMPT')
          ? 'Canada Tire is throttling requests right now. Wait a minute or two, then try again.'
          : null;
        return { success: false, error: friendly || err };
      }

      // Transform API response to our tire format
      const apiTires = (data.data || []).map(item => {
        // Parse size from API format "2,355,019" or "2055516" to "235/50R19" or "205/55R16"
        // (item.size arrives as a number, e.g. 2553518, so coerce to string first)
        let parsedSize = String(item.size || '').trim();
        if (parsedSize) {
          parsedSize = parsedSize.replace(/,/g, '');
          if (parsedSize.length >= 7) {
            const w = parsedSize.slice(0, 3);
            const a = parsedSize.slice(3, 5);
            const r = parsedSize.slice(5, 7);
            parsedSize = `${w}/${a}R${r}`;
          }
        }

        const totalStock = (item.inventory || []).reduce((sum, loc) => sum + (loc.quantity || 0), 0);
        const season = item.isWinter ? 'Winter' : 'All-Season';
        const tier = getTierForBrand('canadaTire', item.brand);

        return {
          id: `ct_${item.partNumber}_${Date.now()}`,
          brand: item.brand,
          model: item.model || item.name || 'Unknown',
          size: parsedSize,
          wholesale: parseFloat(item.cost) || 0,
          stock: totalStock,
          // Per-warehouse quantities from the API, e.g.
          // [{ location: "Dartmouth, NS", quantity: 4 }, ...]
          inventory: item.inventory || [],
          season,
          distributorId: 'canadaTire',
          tier,
          partNumber: item.partNumber,
          msrp: parseFloat(item.msrp) || 0,
          isRunFlat: item.isRunFlat || false,
          // The warehouse this tire was synced for ('' = all warehouses)
          warehouse: filters.location || '',
          createdAt: new Date().toISOString(),
          source: 'api',
        };
      });

      const truncated = apiTires.length > MAX_SYNC_TIRES;
      const imported = truncated ? apiTires.slice(0, MAX_SYNC_TIRES) : apiTires;

      // Replace only the Canada Tire API tires from the same warehouse (or all
      // of them when syncing with no location filter) so per-warehouse syncs merge.
      // Manual price/sale overrides are carried over by part number so the
      // hourly auto-sync doesn't wipe bulk-edit / sale settings.
      setTires(prev => {
        const warehouse = filters.location || '';
        const overrides = {};
        prev.forEach(t => {
          if (t.distributorId === 'canadaTire' && t.source === 'api' && (t.warehouse || '') === warehouse && t.partNumber) {
            overrides[t.partNumber] = {
              price: t.price,
              salePrice: t.salePrice,
              saleStart: t.saleStart,
              saleEnd: t.saleEnd,
            };
          }
        });
        const merged = imported.map(t => ({
          ...t,
          ...(overrides[t.partNumber] ? {
            price: overrides[t.partNumber].price,
            salePrice: overrides[t.partNumber].salePrice,
            saleStart: overrides[t.partNumber].saleStart,
            saleEnd: overrides[t.partNumber].saleEnd,
          } : {}),
        }));
        const kept = prev.filter(t =>
          !(t.distributorId === 'canadaTire' && t.source === 'api' && (t.warehouse || '') === warehouse)
        );
        return [...kept, ...merged];
      });

      // Collect distinct warehouse locations from this response so the sync
      // panel can offer them as a dropdown (e.g. "Toronto, ON").
      const locations = [...new Set(
        (data.data || [])
          .flatMap(item => (item.inventory || []).map(loc => loc.location))
          .filter(Boolean)
      )];
      if (locations.length) addWarehouseLocations(locations);

      setLastSyncAt(new Date().toISOString());
      setIsLoading(false);
      return { success: true, count: imported.length, locations, truncated };
    } catch (err) {
      console.error('Sync error:', err);
      setIsLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  // Canada Tire's RESTlet returns the full per-location inventory for every
  // response regardless of the location filter, so syncing each warehouse
  // separately creates duplicates. Merge by part number: combine inventories,
  // keep the union of warehouses, and drop the duplicate rows.
  const mergePartsByNumber = useCallback(() => {
    setTires(prev => {
      const map = new Map();
      for (const t of prev) {
        if (t.distributorId === 'canadaTire' && t.source === 'api' && t.partNumber) {
          const key = t.partNumber;
          const existing = map.get(key);
          if (existing) {
            const inv = new Map(existing.inventory.map(l => [l.location, l.quantity]));
            // Last-seen wins: each sync in the run is equally fresh, so
            // overwrite rather than sum to avoid double-counting on re-syncs.
            (t.inventory || []).forEach(l => inv.set(l.location, l.quantity));
            existing.inventory = [...inv.entries()].map(([location, quantity]) => ({ location, quantity }));
            existing.stock = existing.inventory.reduce((s, l) => s + l.quantity, 0);
            existing.warehouses = [...new Set([
              ...(existing.warehouses || []),
              ...(t.warehouses || []),
              ...(t.warehouse ? [t.warehouse] : []),
            ])];
            existing.warehouse = existing.warehouses.length === 1 ? existing.warehouses[0] : '';
          } else {
            map.set(key, {
              ...t,
              warehouses: [...new Set([
                ...(t.warehouses || []),
                ...(t.warehouse ? [t.warehouse] : []),
              ])],
            });
          }
        } else {
          map.set(t.id, t);
        }
      }
      return [...map.values()];
    });
  }, []);

    // Sync the full Canada Tire catalog. The RESTlet ignores size/location
  // filters and returns its complete catalog (with per-warehouse inventory)
  // in every response, so a single unfiltered call gets everything — there
  // is no need to call it once per warehouse.
  const syncAllWarehouses = useCallback(async () => {
    if (syncingRef.current) return { success: false, error: 'A sync is already running.' };
    syncingRef.current = true;
    setSyncAllRunning(true);
    setSyncProgress({ running: true, current: 1, total: 1, location: 'All Warehouses' });
    const result = await syncCanadaTire({});
    // Collapse duplicate part numbers (defensive; a fresh sync is already unique)
    mergePartsByNumber();
    syncingRef.current = false;
    setSyncAllRunning(false);
    setSyncProgress({ running: false, done: result.success ? 1 : 0, total: 1, failed: result.success ? 0 : 1 });
    // Let the header show the finished state briefly, then clear it
    setTimeout(() => setSyncProgress(null), 8000);
    return {
      success: result.success,
      count: result.success ? result.count : 0,
      warehouses: 1,
      failures: result.success ? [] : [],
      error: result.error,
    };
  }, [syncCanadaTire, mergePartsByNumber]);

  // Bulk-update multiple tires at once (bulk edit on the search panel).
  // Handles distributor changes (recompute tier per brand) and price
  // adjustments (increase/decrease by an amount or percentage).
  const bulkUpdateTires = useCallback((ids, updates) => {
    setTires(prev => prev.map(t => {
      if (!ids.includes(t.id)) return t;
      const next = { ...t, ...updates, updatedAt: new Date().toISOString() };
      // Recompute the tier when the distributor changes
      if (updates.distributorId && updates.distributorId !== t.distributorId) {
        next.tier = getTierForBrand(updates.distributorId, t.brand);
      }
      // Apply a relative price adjustment on top of the current price
      if (updates.priceAdjust) {
        const { mode, amount, unit } = updates.priceAdjust;
        const base = typeof next.price === 'number' && next.price > 0
          ? next.price
          : calculateRetailPrice(next.wholesale);
        const delta = unit === '%' ? (base * amount) / 100 : amount;
        next.price = Math.max(0, mode === 'decrease' ? base - delta : base + delta);
        delete next.priceAdjust;
      }
      return next;
    }));
  }, []);

  const addTire = useCallback((tire) => {
    const newTire = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      // Ensure all required fields have defaults
      brand: tire.brand || 'Unknown',
      model: tire.model || 'Unknown',
      size: (tire.size || '').toString().toUpperCase(),
      wholesale: parseFloat(tire.wholesale) || 0,
      stock: parseInt(tire.stock, 10) || 0,
      season: tire.season || 'All-Season',
      distributorId: tire.distributorId || 'canadaTire',
      tier: tire.tier || getTierForBrand(tire.distributorId || 'canadaTire', tire.brand),
      ...tire, // Spread again to allow overrides
    };
    // Update state and trigger localStorage save via useEffect
    setTires(prev => {
      const updated = [...prev, newTire];
      return updated;
    });
    return newTire;
  }, []);

  const updateTire = useCallback((id, updates) => {
    setTires(prev => prev.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t));
  }, []);

  const deleteTire = useCallback((id) => {
    const t = tiresRef.current.find(x => x.id === id);
    if (t && t.source !== 'api') deletedKeysRef.current.add(manualSyncKey(t));
    setTires(prev => prev.filter(x => x.id !== id));
  }, []);

  const deleteTires = useCallback((ids) => {
    for (const t of tiresRef.current) {
      if (ids.includes(t.id) && t.source !== 'api') deletedKeysRef.current.add(manualSyncKey(t));
    }
    setTires(prev => prev.filter(x => !ids.includes(t.id)));
  }, []);

  const clearAll = useCallback(() => {
    setTires([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // FIXED: Case-insensitive CSV import with normalization & visibility guarantee
  const importFromCSV = useCallback((parsedData) => {
    const imported = parsedData
      .filter(row => row.brand || row.model || row.size)
      .map((row, idx) => {
        // Try multiple column name variations (case-insensitive)
        const rawDistributor = row.distributor || row.Distributor || row.source || row.Source;
        const distributorId = normalizeDistributor(rawDistributor);
        
        if (!rawDistributor) {
          console.warn('⚠️  No distributor specified for row', idx + 1, ':', {
            brand: row.brand || row.Brand,
            model: row.model || row.Model,
            size: row.size || row.Size,
          });
        }
        
        const brand = row.brand || row.Brand || row.make || row.Make || 'Unknown';
        const season = normalizeSeason(row.season || row.Season);
        const finalDistributorId = distributorId || 'canadaTire'; // Falls back to canadaTire if unrecognized
        
        return {
          id: `import_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          brand,
          model: row.model || row.Model || row.name || row.Name || 'Unknown',
          size: (row.size || row.Size || '').toString().toUpperCase(),
          wholesale: parseFloat(row.wholesale || row.Wholesale || row.cost || row.Cost || row.price || row.Price || 0),
          stock: parseInt(row.stock || row.Stock || row.qty || row.Qty || row.quantity || row.Quantity || 0, 10),
          season,
          distributorId: finalDistributorId,
          tier: getTierForBrand(finalDistributorId, brand),
          createdAt: new Date().toISOString(),
          source: 'csv', // Tag imported data
        };
      });
    
    if (imported.length === 0) {
      console.warn('No valid rows to import');
      return 0;
    }
    
    // Update state and trigger localStorage save via useEffect
    setTires(prev => [...prev, ...imported]);
    console.log(`✅ Imported ${imported.length} tires`);
    return imported.length;
  }, []);

  const loadSampleData = useCallback(() => {
    const sample = [
      { id: 's1', brand: 'Nexen', model: 'NFera AU7', size: '205/55R16', wholesale: 54.06, stock: 12, season: 'All-Season', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's2', brand: 'Cooper', model: 'CS5 Grand Touring', size: '205/55R16', wholesale: 62.30, stock: 8, season: 'All-Season', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's3', brand: 'Kenda Tire', model: 'KR32', size: '205/55R16', wholesale: 48.50, stock: 20, season: 'All-Season', distributorId: 'canadaTire', tier: 'midRange', createdAt: new Date().toISOString() },
      { id: 's4', brand: 'Ovation', model: 'VI-682', size: '205/55R16', wholesale: 38.25, stock: 15, season: 'All-Season', distributorId: 'canadaTire', tier: 'affordable', createdAt: new Date().toISOString() },
      { id: 's5', brand: 'Yokohama', model: 'Avid Ascend GT', size: '205/55R16', wholesale: 71.40, stock: 6, season: 'All-Season', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's6', brand: 'Kumho', model: 'Solus TA71', size: '205/55R16', wholesale: 58.90, stock: 10, season: 'All-Season', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's7', brand: 'Radar Dimax', model: 'R8+', size: '205/55R16', wholesale: 45.00, stock: 18, season: 'All-Season', distributorId: 'starTires', tier: 'midRange', createdAt: new Date().toISOString() },
      { id: 's8', brand: 'Joyroad', model: 'RX702', size: '205/55R16', wholesale: 35.80, stock: 25, season: 'All-Season', distributorId: 'starTires', tier: 'affordable', createdAt: new Date().toISOString() },
      { id: 's9', brand: 'BOTO', model: 'BS66', size: '205/55R16', wholesale: 32.50, stock: 30, season: 'All-Season', distributorId: 'convenient', tier: 'affordable', createdAt: new Date().toISOString() },
      { id: 's10', brand: 'Winda', model: 'WH16', size: '205/55R16', wholesale: 30.00, stock: 22, season: 'All-Season', distributorId: 'convenient', tier: 'affordable', createdAt: new Date().toISOString() },
      { id: 's11', brand: 'Nexen', model: 'Winguard Sport 2', size: '205/55R16', wholesale: 68.00, stock: 14, season: 'Winter', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's12', brand: 'Cooper', model: 'Discoverer Snow Claw', size: '205/55R16', wholesale: 75.20, stock: 9, season: 'Winter', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's13', brand: 'Kenda Tire', model: 'KR36', size: '205/55R16', wholesale: 52.00, stock: 16, season: 'Winter', distributorId: 'canadaTire', tier: 'midRange', createdAt: new Date().toISOString() },
      { id: 's14', brand: 'Yokohama', model: 'iceGUARD iG52c', size: '205/55R16', wholesale: 82.50, stock: 5, season: 'Winter', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's15', brand: 'Kumho', model: 'Wintercraft WP72', size: '205/55R16', wholesale: 65.00, stock: 11, season: 'Winter', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's16', brand: 'Joyroad', model: 'RX818', size: '205/55R16', wholesale: 42.00, stock: 20, season: 'Winter', distributorId: 'starTires', tier: 'affordable', createdAt: new Date().toISOString() },
      { id: 's17', brand: 'BOTO', model: 'BS68', size: '205/55R16', wholesale: 38.00, stock: 28, season: 'Winter', distributorId: 'convenient', tier: 'affordable', createdAt: new Date().toISOString() },
      { id: 's18', brand: 'Nexen', model: 'Nblue 4Season', size: '205/55R16', wholesale: 60.00, stock: 7, season: 'All-Weather', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's19', brand: 'Cooper', model: 'Discoverer All-Season', size: '205/55R16', wholesale: 55.00, stock: 13, season: 'All-Weather', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's20', brand: 'Kumho', model: 'Solus 4S HA32', size: '205/55R16', wholesale: 59.00, stock: 8, season: 'All-Weather', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's21', brand: 'Nexen', model: 'Roadian AT Pro RA8', size: '265/70R17', wholesale: 95.00, stock: 6, season: 'All-Terrain', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's22', brand: 'Cooper', model: 'Discoverer AT3 4S', size: '265/70R17', wholesale: 110.00, stock: 4, season: 'All-Terrain', distributorId: 'canadaTire', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's23', brand: 'Yokohama', model: 'Geolandar A/T G015', size: '265/70R17', wholesale: 105.00, stock: 5, season: 'All-Terrain', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
      { id: 's24', brand: 'Kumho', model: 'Road Venture AT51', size: '265/70R17', wholesale: 98.00, stock: 7, season: 'All-Terrain', distributorId: 'starTires', tier: 'premium', createdAt: new Date().toISOString() },
    ];
    setTires(sample);
  }, []);


  // Export a full backup of the inventory (for moving data between devices
  // or browsers — the app stores data in each browser's localStorage).
  const exportData = useCallback(() => ({
    exportedAt: new Date().toISOString(),
    tires,
    warehouseLocations,
    lastSyncAt,
  }), [tires, warehouseLocations, lastSyncAt]);

  // Merge a backup created by exportData into the current inventory.
  // Existing tires are kept: synced Canada Tire tires are matched by part
  // number (so a fresh sync is never lost or duplicated), and manual tires
  // (Star Tires / Convenient / CSV) are matched by distributor+brand+model+size.
  const importData = useCallback((json) => {
    try {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || !Array.isArray(data.tires)) {
        return { success: false, error: 'Invalid backup file — expected a QuickRev export.' };
      }
      const backup = data.tires.filter(t => t && t.brand && t.size);
      const existing = new Set(tires.map(t =>
        t.partNumber
          ? `api:${t.partNumber}`
          : `manual:${t.distributorId || ''}:${String(t.brand || '').toLowerCase()}:${String(t.model || '').toLowerCase()}:${String(t.size || '').toLowerCase()}`
      ));
      const added = backup.filter(t => {
        const key = t.partNumber
          ? `api:${t.partNumber}`
          : `manual:${t.distributorId || ''}:${String(t.brand || '').toLowerCase()}:${String(t.model || '').toLowerCase()}:${String(t.size || '').toLowerCase()}`;
        return !existing.has(key);
      });
      if (added.length) setTires(prev => [...prev, ...added]);
      if (Array.isArray(data.warehouseLocations) && data.warehouseLocations.length) {
        setWarehouseLocations(prev => [...new Set([...prev, ...data.warehouseLocations])].sort());
      }
      if (data.lastSyncAt) setLastSyncAt(data.lastSyncAt);
      return { success: true, added: added.length, skipped: backup.length - added.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [tires]);

  // ---- Cloud sync: share manual tires & price/sale edits across devices ----
  // Pull the server's shared data once on load, then push changes in the
  // background after every local edit (debounced). The Canada Tire catalog
  // itself stays local (it is reproducible via the Sync button), so only the
  // user-created data is uploaded.
  const pullServerData = useCallback(async () => {
    try {
      const res = await fetch('/api/sync-data', { headers: { 'X-Sync-Key': SYNC_KEY } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { data } = await res.json();
      if (!data) return { success: true };
      const serverManual = Array.isArray(data.manualTires) ? data.manualTires : [];
      const serverOverrides = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
      const serverDeleted = new Set(Array.isArray(data.deletedKeys) ? data.deletedKeys : []);

      setTires(prev => {
        // Drop locally-deleted manual tires that the server also marks gone
        // (prevents them from resurrecting on this device).
        let next = prev.filter(t => t.source === 'api' || !serverDeleted.has(manualSyncKey(t)));

        // Merge the server's manual tires: server wins per tire (newest
        // updatedAt); local-only tires are kept and seeded by the next push.
        if (serverManual.length > 0) {
          const serverMap = new Map(serverManual.map(t => [t.syncKey || manualSyncKey(t), t]));
          const merged = new Map();
          for (const t of next) {
            if (t.source !== 'api') merged.set(manualSyncKey(t), t);
          }
          for (const [k, st] of serverMap) {
            const lt = merged.get(k);
            if (!lt || (st.updatedAt || '') >= (lt.updatedAt || '')) merged.set(k, st);
          }
          next = [...next.filter(t => t.source === 'api'), ...merged.values()];
        }

        // Price/sale overrides for synced Canada Tire tires. The server is
        // authoritative when it has any (a sale cleared on one device clears
        // it everywhere); with no server data yet, local overrides are kept
        // and seeded by the first push.
        if (Object.keys(serverOverrides).length > 0) {
          next = next.map(t => {
            if (t.source !== 'api' || !t.partNumber) return t;
            const o = serverOverrides[t.partNumber];
            if (o) {
              return { ...t, price: o.price, salePrice: o.salePrice, saleStart: o.saleStart, saleEnd: o.saleEnd };
            }
            return { ...t, price: undefined, salePrice: undefined, saleStart: undefined, saleEnd: undefined };
          });
        }
        return next;
      });

      if (Array.isArray(data.warehouseLocations) && data.warehouseLocations.length) {
        setWarehouseLocations(prev => [...new Set([...prev, ...data.warehouseLocations])].sort());
      }
      setCloudSyncStatus('ok');
      return { success: true };
    } catch (err) {
      console.warn('Cloud sync pull failed (app keeps working offline):', err.message);
      setCloudSyncStatus('error');
      return { success: false };
    }
  }, []);

  const pushServerData = useCallback(async () => {
    const current = tiresRef.current;
    const manualTires = current
      .filter(t => t.source !== 'api')
      .map(t => ({ ...t, syncKey: manualSyncKey(t), updatedAt: t.updatedAt || t.createdAt || null }));
    const overrides = {};
    for (const t of current) {
      if (t.source === 'api' && t.partNumber &&
          (t.price !== undefined || t.salePrice !== undefined || t.saleStart !== undefined || t.saleEnd !== undefined)) {
        overrides[t.partNumber] = {
          price: t.price,
          salePrice: t.salePrice,
          saleStart: t.saleStart,
          saleEnd: t.saleEnd,
          updatedAt: t.updatedAt || null,
        };
      }
    }
    setCloudSyncStatus('syncing');
    try {
      const res = await fetch('/api/sync-data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SYNC_KEY },
        body: JSON.stringify({
          manualTires,
          overrides,
          deletedKeys: [...deletedKeysRef.current],
          warehouseLocations: locationsRef.current,
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setCloudSyncStatus('ok');
      return { success: true };
    } catch (err) {
      console.warn('Cloud sync push failed (edits stay on this device):', err.message);
      setCloudSyncStatus('error');
      return { success: false };
    }
  }, []);

  // Pull once on load, then seed anything the server does not have yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await pullServerData();
      if (!cancelled) {
        hydratedRef.current = true;
        await pushServerData();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced background push after any local change.
  useEffect(() => {
    if (!hydratedRef.current) return;
    clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => { pushServerData(); }, 800);
    return () => clearTimeout(pushTimerRef.current);
  }, [tires, warehouseLocations, pushServerData]);

  const getDistributorName = useCallback((id) => {
    return DISTRIBUTORS.find(d => d.id === id)?.name || id;
  }, []);

  return {
    tires,
    isLoading,
    apiStatus,
    warehouseLocations,
    lastSyncAt,
    addWarehouseLocations,
    fetchWarehouseLocations,
    addTire,
    updateTire,
    deleteTire,
    deleteTires,
    bulkUpdateTires,
    clearAll,
    importFromCSV,
    loadSampleData,
    getDistributorName,
    exportData,
    importData,
    cloudSyncStatus,
    syncCanadaTire,
    syncAllWarehouses,
    syncAllRunning,
    syncProgress,
    checkApiHealth,
  };
}