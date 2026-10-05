/**
 * Parse the STARCO Rim Guide markdown export into the QuickRev fitment shape.
 *
 * Source format: `## MAKE` sections with 8-column tables:
 *   | Model | Trim | Years | Size | Bolt | Exact Fit SKUs | Multi-Application SKUs | Notes |
 *
 * Produces fitment objects: { year, make, model, trim, rimSize, sku,
 * exactFitSkus, multiFitSkus, notes, boltPattern, source }.
 * Year ranges are stored compactly ("2025-2027") — the finder components
 * expand ranges when filtering, keeping the shared store small (~2.7k rows
 * instead of ~18k fully-expanded years).
 */

// A plausible rim SKU: letter prefix (STX/SX/STA/…), 4–6 digits, optional
// letter suffix. Filters OCR junk like the stray "66" seen in the source.
const SKU_RE = /^[A-Z]{2,4}\d{4,6}[A-Z]?$/i;

// Model names that are actually OCR'd SKU fragments (e.g. "X 12T956", "SRXSRX")
// rather than vehicles — skip them so they don't pollute the fitment DB.
function isJunkModel(model) {
  if (!model) return true;
  if (/^[A-Z]{2,6}\d{4,6}[A-Z]?$/i.test(model)) return true;        // SRXSRX-like / fragment glue
  if (/^\d/.test(model)) return true;                                // starts with digits
  if (/^X?\s*\d{1,3}[A-Z]\d{3,6}$/i.test(model)) return true;       // "X 12T956"
  if (/^(\S{2,6})\1+$/.test(model)) return true;                     // duplicated fragment, e.g. "SRXSRX"
  if (model.length > 40) return true;
  return false;
}

// "5-114-3" / "5 - 112" / "4-100" → "5X114.3" style bolt pattern.
function normBolt(bolt) {
  const m = String(bolt || '').replace(/\s+/g, '').match(/^(\d)-(\d{2,3})(?:[.-](\d+))?$/);
  if (!m) return '';
  return `${m[1]}X${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

// "2025 - 2027" → "2025-2027"; "2025" → "2025"; "-" → "".
function normYears(years) {
  const s = String(years || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '-') return '';
  const m = s.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (m) return `${m[1]}-${Math.max(+m[1], +m[2])}`;
  if (/^\d{4}$/.test(s)) return s;
  return s; // unusual text — keep as-is so it is still searchable
}

// Split a SKU cell into clean, deduped, comma-joined SKU list.
function normSkus(cell) {
  const seen = new Set();
  for (const tok of String(cell || '').split(/[\s,;]+/)) {
    const t = tok.trim().toUpperCase();
    if (t && t !== '-' && SKU_RE.test(t)) seen.add(t);
  }
  return [...seen].join(', ');
}

export function parseRimGuideMd(text, sourceLabel = 'Starco Rim Guide') {
  const fitments = [];
  const seen = new Set();
  let make = '';
  let skipped = 0;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) { make = heading[1].trim().toUpperCase(); continue; }
    if (!line.startsWith('|') || !make) continue;

    const c = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(s => s.trim());
    if (c.length !== 8 || c[0] === 'Model') continue;
    if (c.every(x => /^-*$/.test(x))) continue; // header separator row

    const [model, trim, years, size, bolt, exact, multi, notes] = c;
    if (isJunkModel(model)) { skipped++; continue; }

    const exactSkus = normSkus(exact);
    const multiSkus = normSkus(multi);
    const fitment = {
      year: normYears(years),
      make,
      model: model.replace(/\s+/g, ' ').toUpperCase(),
      trim: trim && trim !== '-' ? trim.replace(/\s+/g, ' ').toUpperCase() : '',
      rimSize: size && size !== '-' ? size : '',
      sku: exactSkus.split(',')[0] || multiSkus.split(',')[0] || '',
      exactFitSkus: exactSkus,
      multiFitSkus: multiSkus,
      notes: notes && notes !== '-' ? notes : '',
      boltPattern: normBolt(bolt),
      source: sourceLabel,
    };
    // Skip rows with no SKUs AND no usable rim size (nothing to offer).
    if (!fitment.sku && !fitment.rimSize) { skipped++; continue; }

    const key = [fitment.year, fitment.make, fitment.model, fitment.trim,
      fitment.rimSize, fitment.exactFitSkus, fitment.multiFitSkus].join('|');
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    fitments.push(fitment);
  }

  return { fitments, skipped };
}

// Merge parsed fitments into an existing list, skipping entries whose full
// identity key already exists (same vehicle + rim + SKUs).
export function mergeFitments(existing, incoming) {
  const keyOf = (f) => [f.year, f.make, f.model, f.trim, f.rimSize,
    f.exactFitSkus, f.multiFitSkus].map(x => String(x || '')).join('|');
  const seen = new Set((existing || []).map(keyOf));
  const added = [];
  for (const f of incoming || []) {
    const k = keyOf(f);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push(f);
  }
  return added;
}
