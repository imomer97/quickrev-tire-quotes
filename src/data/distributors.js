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
 * Parse tire size string like "205/55R16" into components
 */
export function parseTireSize(sizeStr) {
  const match = sizeStr.match(/^(\d{3})\/(\d{2,3})R(\d{2})$/i);
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