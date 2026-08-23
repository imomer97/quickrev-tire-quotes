// ========== ENVIRONMENTAL FEE ==========
// $4.50 per tire — added to wholesale cost, NOT shown separately on sale price
export const ENV_FEE_PER_TIRE = 4.50;

// ========== MARKUP ==========
export const MARKUP_PER_TIRE = 10.00;

// ========== HST NS ==========
export const HST_RATE = 0.14;

// ========== INSTALLATION RATES (from calculator) ==========
// Off-rims installation for NEW tires purchased from QuickRev
// Base rates by vehicle type
export const VEHICLE_BASE_RATES = {
  sedan: 22.50,
  miniSuv: 26.25,
  lsSuv: 28.75,
  truck: 31.25,
  cargo: 35.00,
};

// Aspect ratio surcharge (lower = wider tire = harder to mount)
export const ASPECT_SURCHARGE = {
  40: 1.25,
  35: 3.75,
  30: 7.50,
  25: 12.50,
};

// Width surcharge: $1.25 per 10mm step above 235mm
export const WIDTH_STEP = 10; // mm
export const WIDTH_SURCHARGE_PER_STEP = 1.25;
export const WIDTH_BASE = 235; // mm - no surcharge below this

// Rim size surcharge: $1.25 per inch above 18"
export const RIM_SURCHARGE_PER_INCH = 1.25;
export const RIM_BASE = 18; // inches - no surcharge below this

// QuickRev discount when buying tires from us
export const QUICKREV_DISCOUNT = 0.10; // 10% off installation

// ========== VEHICLE TYPE LABELS ==========
export const VEHICLE_LABELS = {
  sedan: 'Sedan',
  miniSuv: 'Mini SUV',
  lsSuv: 'Large SUV',
  truck: 'Truck',
  cargo: 'Cargo Van',
};

// ========== SEASONS ==========
export const SEASONS = ['All-Season', 'Winter', 'All-Weather', 'All-Terrain'];

// ========== DISTRIBUTORS ==========
export const DISTRIBUTORS = [
  { id: 'canadaTire', name: 'Canada Tire', hasApi: true },
  { id: 'starTires', name: 'Star Tires LTD', hasApi: false },
  { id: 'convenient', name: 'Convenient Auto & Tire', hasApi: false },
];

// ========== TIRE TIERS ==========
export const TIERS = {
  premium: 'Premium',
  midRange: 'Mid-Range',
  affordable: 'Affordable',
};

// ========== DISTRIBUTOR BRAND MAPPING ==========
export const DISTRIBUTOR_BRANDS = {
  canadaTire: {
    premium: ['Nexen', 'Cooper', 'Vredestein'],
    midRange: ['Kenda Tire'],
    affordable: ['Ovation', 'Minerva'],
  },
  starTires: {
    premium: ['Yokohama', 'Kumho'],
    midRange: ['Radar Dimax'],
    affordable: ['Lanvigator', 'Joyroad'],
  },
  convenient: {
    affordable: ['BOTO', 'Winda', 'Haida'],
  },
};

// ========== PRICING CALCULATION ==========

/**
 * Calculate the purchase cost (wholesale + env fee)
 * This is what QuickRev pays the distributor
 */
export function calculatePurchaseCost(wholesale) {
  return wholesale + ENV_FEE_PER_TIRE;
}

/**
 * Calculate the retail tire price before HST (tire only)
 * purchase cost + markup
 */
export function calculateRetailPrice(wholesale) {
  const purchaseCost = calculatePurchaseCost(wholesale);
  return purchaseCost + MARKUP_PER_TIRE;
}

/**
 * Calculate HST on the retail price (tire only)
 */
export function calculateHST(wholesale) {
  const retailPrice = calculateRetailPrice(wholesale);
  return retailPrice * HST_RATE;
}

/**
 * Calculate total tire price (retail + HST) per tire
 * Does NOT include installation
 */
export function calculateTireTotal(wholesale) {
  const retailPrice = calculateRetailPrice(wholesale);
  const hst = retailPrice * HST_RATE;
  return retailPrice + hst;
}

/**
 * Calculate installation cost per tire
 * @param {number} width - tire width in mm (e.g., 205)
 * @param {number} aspect - aspect ratio (e.g., 55)
 * @param {number} rim - rim diameter in inches (e.g., 16)
 * @param {string} vehicleType - key from VEHICLE_BASE_RATES
 * @param {boolean} buyFromQuickRev - apply 10% discount?
 */
export function calculateInstallationPerTire(width, aspect, rim, vehicleType, buyFromQuickRev = false) {
  const baseRate = VEHICLE_BASE_RATES[vehicleType] || VEHICLE_BASE_RATES.sedan;

  // Aspect surcharge (only for low aspect ratios)
  let aspectSurcharge = 0;
  const sortedAspects = Object.keys(ASPECT_SURCHARGE).map(Number).sort((a, b) => b - a);
  for (const a of sortedAspects) {
    if (aspect <= a) {
      aspectSurcharge = ASPECT_SURCHARGE[a];
    }
  }

  // Width surcharge (only above 235mm)
  let widthSurcharge = 0;
  if (width > WIDTH_BASE) {
    const steps = Math.ceil((width - WIDTH_BASE) / WIDTH_STEP);
    widthSurcharge = steps * WIDTH_SURCHARGE_PER_STEP;
  }

  // Rim surcharge (only above 18")
  let rimSurcharge = 0;
  if (rim > RIM_BASE) {
    const inchesAbove = rim - RIM_BASE;
    rimSurcharge = inchesAbove * RIM_SURCHARGE_PER_INCH;
  }

  const subtotal = baseRate + aspectSurcharge + widthSurcharge + rimSurcharge;

  // Apply QuickRev discount if buying tires from us
  if (buyFromQuickRev) {
    return subtotal * (1 - QUICKREV_DISCOUNT);
  }
  return subtotal;
}

/**
 * NEW: Calculate tire + installation BEFORE tax
 * Both are taxable in Nova Scotia
 * @param {number} wholesale - tire wholesale price
 * @param {number} width - tire width in mm
 * @param {number} aspect - aspect ratio
 * @param {number} rim - rim diameter in inches
 * @param {string} vehicleType - vehicle type key
 * @param {boolean} buyFromQuickRev - apply discount?
 * @returns {number} sum of retail tire price + installation (pre-HST)
 */
export function calculateTotalPreTax(wholesale, width, aspect, rim, vehicleType, buyFromQuickRev = false) {
  const retailPrice = calculateRetailPrice(wholesale);
  const installPerTire = calculateInstallationPerTire(width, aspect, rim, vehicleType, buyFromQuickRev);
  return retailPrice + installPerTire;
}

/**
 * NEW: Calculate HST on combined tire + installation
 * @param {number} wholesale - tire wholesale price
 * @param {number} width - tire width in mm
 * @param {number} aspect - aspect ratio
 * @param {number} rim - rim diameter in inches
 * @param {string} vehicleType - vehicle type key
 * @param {boolean} buyFromQuickRev - apply discount?
 * @returns {number} HST amount
 */
export function calculateTotalHST(wholesale, width, aspect, rim, vehicleType, buyFromQuickRev = false) {
  const totalPreTax = calculateTotalPreTax(wholesale, width, aspect, rim, vehicleType, buyFromQuickRev);
  return totalPreTax * HST_RATE;
}

/**
 * NEW: Calculate final price per tire including installation + HST
 * This is the price to show the customer
 * @param {number} wholesale - tire wholesale price
 * @param {number} width - tire width in mm
 * @param {number} aspect - aspect ratio
 * @param {number} rim - rim diameter in inches
 * @param {string} vehicleType - vehicle type key
 * @param {boolean} buyFromQuickRev - apply discount?
 * @returns {number} final price with tax
 */
export function calculateTotalWithTax(wholesale, width, aspect, rim, vehicleType, buyFromQuickRev = false) {
  const preTax = calculateTotalPreTax(wholesale, width, aspect, rim, vehicleType, buyFromQuickRev);
  const hst = calculateTotalHST(wholesale, width, aspect, rim, vehicleType, buyFromQuickRev);
  return preTax + hst;
}

/**
 * Parse tire size string into components.
 * Accepts all common formats: "205/55R16", "20555R16", "2055516",
 * "2,355,019" (comma-separated digits), "2355019".
 */
export function parseTireSize(sizeStr) {
  if (!sizeStr) return null;
  const compact = String(sizeStr).toUpperCase().replace(/[^0-9]/g, '');
  const match = compact.match(/^(\d{3})(\d{2,3})(\d{2})$/);
  if (!match) return null;
  return {
    width: parseInt(match[1], 10),
    aspect: parseInt(match[2], 10),
    rim: parseInt(match[3], 10),
  };
}

/**
 * Get tier for a brand within a distributor
 */
export function getTierForBrand(distributorId, brand) {
  const brands = DISTRIBUTOR_BRANDS[distributorId];
  if (!brands) return 'affordable';
  for (const [tier, brandList] of Object.entries(brands)) {
    if (brandList.includes(brand)) return tier;
  }
  return 'affordable';
}

/**
 * Format currency
 */
export function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
}

/**
 * Format tire size for display
 */
export function formatSize(sizeStr) {
  return sizeStr.toUpperCase();
}

// ========== SALE PRICING ==========

/**
 * Regular price: an explicit per-tire price override (set via edit / bulk edit),
 * otherwise the standard wholesale + env fee + markup retail price.
 */
export function getRegularPrice(tire) {
  if (typeof tire.price === 'number' && tire.price > 0) return tire.price;
  return calculateRetailPrice(tire.wholesale);
}

/**
 * Sale status: salePrice applies only between saleStart and saleEnd (inclusive).
 * When it expires, the regular price takes over automatically.
 */
export function getSaleInfo(tire) {
  const salePrice = typeof tire.salePrice === 'number' && tire.salePrice > 0 ? tire.salePrice : null;
  if (!salePrice) return { saleActive: false, salePrice: null, saleStart: null, saleEnd: null };
  const now = new Date();
  const start = tire.saleStart ? new Date(tire.saleStart) : null;
  const end = tire.saleEnd ? new Date(tire.saleEnd) : null;
  const started = !start || start <= now;
  const notEnded = !end || now <= end;
  return { saleActive: started && notEnded, salePrice, saleStart: start, saleEnd: end };
}

/** The price a customer actually pays today (sale while active, else regular) */
export function getEffectiveRetail(tire) {
  const sale = getSaleInfo(tire);
  return sale.saleActive ? sale.salePrice : getRegularPrice(tire);
}

// ========== TRAVEL SURCHARGE (by postal code) ==========
// Source: quickrev_postal_codes.md — QuickRev Postal Code Service Area Logic

export const POSTAL_ZONE_LABELS = {
  zone1: 'Halifax',
  zone2: 'Dartmouth',
  zone3: 'Bedford & Sackville',
  suburban: 'Suburban',
  rural: 'Rural',
  unknown: 'Outside service area',
};

// FSA → zone for flat-rate zones (no surcharge)
export const POSTAL_ZONE_MAP = {
  // Zone 1 — Halifax
  B3H: 'zone1', B3J: 'zone1', B3K: 'zone1', B3L: 'zone1', B3M: 'zone1',
  B3N: 'zone1', B3P: 'zone1', B3R: 'zone1', B3S: 'zone1',
  // Zone 2 — Dartmouth core
  B2V: 'zone2', B2X: 'zone2', B2Y: 'zone2', B3A: 'zone2', B3B: 'zone2',
  // Zone 3 — Bedford & Sackville
  B4A: 'zone3', B4C: 'zone3',
};

// Suburban (fixed surcharge)
export const POSTAL_SUBURBAN_INFO = {
  B3G: { area: 'Eastern Passage', surcharge: 15 },
};

// Rural (fixed surcharge)
export const POSTAL_RURAL_INFO = {
  B3E: { area: 'Porters Lake / Eastern Shore corridor', surcharge: 68 },
  B4G: { area: 'Beaverbank / Kinsac', surcharge: 45 },
  B2R: { area: 'Waverley', surcharge: 42 },
  B2S: { area: 'Preston / Lantz', surcharge: 57 },
  B2T: { area: 'Enfield / Fall River', surcharge: 68 },
};

// Multi-area FSAs: user must pick a sub-area (each has its own pricing)
export const POSTAL_SUB_OPTIONS = {
  B2W: [
    { label: 'Woodlawn / Portland Hills / Shearwater', type: 'suburban', fee: 20 },
    { label: 'Westphal / Lake Loon / Cole Harbour', type: 'rural', fee: 33 },
  ],
  B2Z: [
    { label: 'Cole Harbour / Westphal', type: 'rural', fee: 33 },
    { label: 'Cherry Brook / North Preston / East Preston', type: 'rural', fee: 38 },
    { label: 'Lawrencetown / East, West & Upper / Mineville', type: 'rural', fee: 50 },
  ],
  B3V: [
    { label: 'Herring Cove / Harrietsfield / Williamswood / Fergusons Cove', type: 'zone1', fee: 27 },
    { label: 'Halibut Bay / Bear Cove / East Pennant / West Pennant', type: 'rural', fee: 33 },
    { label: 'Portuguese Cove / Duncans Cove', type: 'rural', fee: 39 },
    { label: 'Sambro / Ketch Harbour / Sambro Creek / Sambro Head', type: 'rural', fee: 48 },
  ],
  B3T: [
    { label: 'Beechville / Lakeside (BLT)', type: 'zone1', fee: 0 },
    { label: 'Timberlea / Goodwood', type: 'zone1', fee: 27 },
    { label: 'Brookside / Hatchet Lake', type: 'rural', fee: 34 },
    { label: 'Whites Lake / Shad Bay', type: 'rural', fee: 45 },
    { label: 'Prospect / Terence Bay / Prospect Bay', type: 'rural', fee: 50 },
  ],
  B3Z: [
    { label: 'Hammonds Plains', type: 'rural', fee: 42 },
    { label: 'Tantallon', type: 'rural', fee: 48 },
    { label: 'Upper Tantallon', type: 'rural', fee: 55 },
    { label: 'Head of St Margarets Bay / Peggys Cove', type: 'rural', fee: 68 },
  ],
  B4B: [
    { label: 'Bedford (NW)', type: 'zone3', fee: 0 },
    { label: 'Hammonds Plains', type: 'suburban', fee: 20 },
    { label: 'Upper Hammonds Plains', type: 'rural', fee: 42 },
  ],
  B4E: [
    { label: 'Lower Sackville', type: 'zone3', fee: 0 },
    { label: 'Middle Sackville', type: 'suburban', fee: 20 },
    { label: 'Upper Sackville', type: 'rural', fee: 35 },
  ],
};

/**
 * Resolve an FSA (first 3 chars of a postal code) to a zone + travel surcharge.
 * @param {string} fsa - e.g. "B3K", "B2T", "B2W"
 * @param {number} subIndex - index into POSTAL_SUB_OPTIONS for multi-area FSAs
 * @returns {{zone: string, label: string, surcharge: number, options: Array|null, unknown: boolean}}
 */
export function resolvePostalCode(fsa, subIndex = 0) {
  const code = String(fsa || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!code) {
    return { zone: 'unknown', label: '', surcharge: 0, options: null, unknown: true };
  }
  const options = POSTAL_SUB_OPTIONS[code];
  if (options) {
    const opt = options[Math.min(Math.max(subIndex || 0, 0), options.length - 1)];
    return {
      zone: opt.type,
      label: opt.label,
      surcharge: opt.fee,
      options,
      unknown: false,
    };
  }
  const rural = POSTAL_RURAL_INFO[code];
  if (rural) {
    return { zone: 'rural', label: rural.area, surcharge: rural.surcharge, options: null, unknown: false };
  }
  const suburban = POSTAL_SUBURBAN_INFO[code];
  if (suburban) {
    return { zone: 'suburban', label: suburban.area, surcharge: suburban.surcharge, options: null, unknown: false };
  }
  const zone = POSTAL_ZONE_MAP[code];
  if (zone) {
    return { zone, label: POSTAL_ZONE_LABELS[zone] || zone, surcharge: 0, options: null, unknown: false };
  }
  return { zone: 'unknown', label: POSTAL_ZONE_LABELS.unknown, surcharge: 0, options: null, unknown: true };
}