import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import quickrevLogo from '../assets/quickrev-logo.png?inline';
import {
  calculateInstallationPerTire,
  parseTireSize,
  parseWheelSize,
  formatCurrency,
  HST_RATE,
  getRegularPrice,
  getSaleInfo,
  getEffectiveRetail,
  TPMS_PROGRAM_FEE,
  isTpmsItem,
  getInstallFeeForItem,
} from '../data/distributors.js';

/** Compact date like "Aug 15" for the sale-period column */
function shortDate(d) {
  if (!d) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Generate a PDF showing available tire options and estimated costs
 * FIXED: Installation now included in HST calculation
 * FIXED: Sale-aware prices — when a tire is on sale (between saleStart and
 *        saleEnd) the PDF shows the sale price; otherwise the regular price.
 *        The sale period is shown in its own column and in the notes.
 * ADDED: Travel surcharge per postal code (per job, added to the quote).
 * ADDED: Per-item installation control — items flagged includeInstall=false
 *        (e.g. wheels, rims, TPMS sensors, lug nuts) never add installation.
 * ADDED: Free items (isFree) price at $0.00.
 * FIXED: Columns that have no data (Sale Period, Install/Tire) are hidden,
 *        and headers / season / size / price never wrap.
 * This is NOT an invoice — it is an informational document for the customer
 */
export function generateOptionsPDF({
  tires,
  quantity = 4,
  quantityFor = null,
  vehicleType = 'sedan',
  buyFromQuickRev = true,
  includeInstallation = true,
  customerName = '',
  tireSize = '',
  installQty = quantity,
  postalCode = '',
  travelSurcharge = 0,
  // When true, rows keep the order passed in (a manual drag arrangement) instead
  // of being re-sorted by price. Free items are still grouped at the bottom.
  preserveOrder = false,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  // === HEADER ===
  // White header matching the app's white top bar: red QuickRev wordmark on a
  // light background with dark-navy tagline text and a thin divider line.
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, 35, 'F');

  // QuickRev logo (red wordmark on transparent), vertically centred on the band.
  const { width: lw, height: lh } = doc.getImageProperties(quickrevLogo);
  const logoH = 9;
  const logoW = (lw / lh) * logoH;
  doc.addImage(quickrevLogo, 'PNG', margin, (35 - logoH) / 2, logoW, logoH);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Product Options & Estimated Costs', margin, 26);
  doc.text('quickrev.ca', pageWidth - margin, 26, { align: 'right' });

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, 35, pageWidth - margin, 35);

  y = 42;

  // === CUSTOMER INFO ===
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(customerName || '_________________________', margin + 30, y);
  y += 6;

  // Item size + installation count — only shown when relevant.
  const anyInstallRow = tires.some(
    t => includeInstallation && t.includeInstall !== false && (t.category || 'tire') === 'tire' && parseTireSize(t.size)
  );
  if (tireSize) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Item:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(tireSize, margin + 24, y);
    y += 6;
  }
  if (anyInstallRow) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Qty to Install:', 115, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${installQty}`, 115 + 44, y);
    y += 6;
  }
  doc.setFontSize(11);

  doc.setFont('helvetica', 'bold');
  doc.text('Quantity:', margin, y);
  doc.setFont('helvetica', 'normal');
  // Total pieces quoted — the sum of each line's Qty column
  const totalPieces = tires.reduce((sum, t) => sum + (t.isService ? 0 : (quantityFor ? quantityFor(t) : quantity)), 0);
  doc.text(`${totalPieces} item${totalPieces === 1 ? '' : 's'}`, margin + 30, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Vehicle:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1), margin + 30, y);
  if (postalCode) {
    doc.setFont('helvetica', 'bold');
    doc.text('Postal:', 115, y);
    doc.setFont('helvetica', 'normal');
    doc.text(postalCode.toUpperCase(), 115 + 20, y);
  }
  y += 10;

  // === DISCLAIMER ===
  doc.setFillColor(254, 252, 232);
  doc.roundedRect(margin, y - 4, pageWidth - margin * 2, 10, 2, 2, 'F');
  doc.setTextColor(180, 83, 9);
  doc.setFontSize(8);
  doc.text('This document shows estimated costs for available product options (tires, wheels/rims, and auto parts). Prices are subject to change. Not an invoice.', margin + 3, y + 2);
  y += 14;

  // === PRE-COMPUTE ROW DATA ===
  // Prices are sale-aware: effective price = sale price while a sale is active,
  // otherwise the regular price. Regular price is the fallback after a sale ends.
  const onSaleRows = []; // tires currently on sale (for the notes section)
  const pendingSaleRows = []; // sale set but not yet active / already ended

  // Decide which columns exist — hide columns that carry no data.
  const anySale = tires.some(t => typeof t.salePrice === 'number' && t.salePrice > 0);
  const showPeriod = anySale;
  const anyInstall = tires.some(t =>
    includeInstallation && t.includeInstall !== false && (
      isTpmsItem(t) || ((t.category || 'tire') === 'tire' && parseTireSize(t.size))
    )
  );
  const showInstallCol = includeInstallation && anyInstall;

  // One-word category tabs for the first table column (see table headers below)
  const CAT_LABEL = { tire: 'Tire', wheel: 'Wheel', part: 'Part', service: 'Service' };

  const rowMeta = tires.map(tire => {
    const parsed = parseTireSize(tire.size);
    // Installation-service line items are priced as one job (their `price` is
    // the full install total), so they never multiply by the quote quantity.
    // Other lines honor their per-item quantity when provided.
    const itemQty = tire.isService ? 1 : (quantityFor ? quantityFor(tire) : quantity);

    // Sale-aware pricing (matches the item cards). Free items price at $0.
    const tirePrice = getEffectiveRetail(tire);
    const regularPrice = getRegularPrice(tire);
    const sale = getSaleInfo(tire);

    // Installation applies to tires only — wheels/parts (no parseable tire size
    // or explicit opt-out) are excluded. TPMS sensors are the exception: they
    // carry a flat per-sensor programming fee instead of the size-based rate.
    const tpms = isTpmsItem(tire);
    const installEligible = includeInstallation && tire.includeInstall !== false && (
      tpms || (parsed && (tire.category || 'tire') === 'tire')
    );
    let installPerTire = 0;
    let totalHST;
    let grandTotal;

    if (installEligible) {
      // Per-item override > TPMS flat fee > size-based tire rate
      installPerTire = getInstallFeeForItem(tire, parsed, vehicleType, buyFromQuickRev);
      // Installation applies only to the number of tires to be installed (installQty)
      const installTotal = installPerTire * installQty;
      const preTax = tirePrice * itemQty + installTotal;
      totalHST = preTax * HST_RATE;
      grandTotal = preTax + totalHST;
    } else {
      const preTax = tirePrice * itemQty;
      totalHST = preTax * HST_RATE;
      grandTotal = preTax + totalHST;
    }

    // Sale period cell — only when the sale is currently active
    let salePeriod = '';
    if (sale.saleActive) {
      if (sale.saleStart && sale.saleEnd) {
        salePeriod = `${shortDate(sale.saleStart)} – ${shortDate(sale.saleEnd)}`;
      } else if (sale.saleEnd) {
        salePeriod = `until ${shortDate(sale.saleEnd)}`;
      } else if (sale.saleStart) {
        salePeriod = `from ${shortDate(sale.saleStart)}`;
      }
      onSaleRows.push({
        label: `${tire.brand} ${tire.model} (${tire.size})`,
        regularPrice,
        salePrice: sale.salePrice,
        end: sale.saleEnd,
      });
    } else if (sale.salePrice) {
      pendingSaleRows.push({ label: `${tire.brand} ${tire.model} (${tire.size})`, sale });
    }

    // Size cell: for wheels, split the spec onto a second line — bolt pattern
    // and offset are the details a customer needs to verify fitment. Parts keep
    // their fitment note if one is set.
    let sizeCell = tire.size;
    const cat = tire.category || 'tire';
    if (cat === 'wheel') {
      const w = parseWheelSize(tire.size);
      if (w && (w.boltPattern || w.diameter != null)) {
        const lines = [];
        if (w.boltPattern) lines.push(String(w.boltPattern).toUpperCase());
        const dims = [w.diameter != null ? w.diameter : null, w.width != null ? w.width : null].filter(v => v != null);
        if (dims.length) lines.push(dims.join('×'));
        if (w.offset != null && Number.isFinite(w.offset)) lines.push(`ET${w.offset}`);
        sizeCell = lines.join('\n');
      }
    } else if (cat === 'part' && tire.fitment) {
      sizeCell = `${tire.size}\nFits: ${tire.fitment}`;
    }

    const row = [
      CAT_LABEL[tire.category || 'tire'] || 'Tire',
      tire.brand,
      tire.model,
      sizeCell,
      tire.season || '—',
      tire.isService ? '—' : (itemQty != null ? String(itemQty) : tire.stock.toString()),
      formatCurrency(tirePrice),  // effective price (sale while active, else regular)
    ];
    if (showPeriod) row.push(salePeriod);               // e.g. "Aug 1 – 15" or "until Aug 15"
    if (showInstallCol) row.push(installPerTire > 0 ? formatCurrency(installPerTire) : '—');  // Installation / programming (per item)
    row.push(formatCurrency(totalHST), formatCurrency(grandTotal));
    return { cells: row, price: tirePrice, isFree: !!tire.isFree };
  });

  // Default order for customers: by effective price per tire, lowest first,
  // with free items ($0.00 gifts/accessories) grouped at the very bottom.
  // When the user has manually dragged the quote into a custom order
  // (preserveOrder), respect that exact order — the PDF mirrors the
  // on-screen quote panel.
  if (!preserveOrder) {
    rowMeta.sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? 1 : -1;
      return (a.price || 0) - (b.price || 0);
    });
  }
  const rows = rowMeta.map(r => r.cells);

  // === TABLE HEADERS ===
  // First column is a one-word category tab so the customer can scan tires vs.
  // wheels/rims vs. parts at a glance. Absent/legacy items render as "Tire".
  const tableHeaders = ['Category', 'Brand', 'Model', 'Size', 'Season', 'Qty', 'Price/Tire'];
  if (showPeriod) tableHeaders.push('Sale Period');
  if (showInstallCol) tableHeaders.push('Install/Tire');
  tableHeaders.push('HST (14%)', 'Total');

  // Fixed widths keep headers / season / size / price from wrapping the text.
  // Model (index 1) auto-sizes to whatever width remains on the page.
  const col = { category: 0, brand: 1, model: 2, size: 3, season: 4, stock: 5, price: 6 };
  let next = 7;
  if (showPeriod) col.period = next++;
  if (showInstallCol) col.install = next++;
  col.hst = next++;
  col.total = next++;

  // Fixed widths that are wide enough to keep every header (Stock, Price/Tire,
  // Install/Tire, HST (14%), Sale Period) on a single line. Model auto-sizes to
  // whatever width remains.
  const columnStyles = {
    [col.category]: { cellWidth: 18 },
    [col.brand]: { cellWidth: 16 },
    [col.size]: { cellWidth: 26 },
    [col.season]: { cellWidth: 20 },
    [col.stock]: { cellWidth: 12 },
    [col.price]: { cellWidth: 19 },
  };
  if (showPeriod) columnStyles[col.period] = { cellWidth: 22 };
  if (showInstallCol) columnStyles[col.install] = { cellWidth: 23 };
  columnStyles[col.hst] = { cellWidth: 19 };
  columnStyles[col.total] = { cellWidth: 19 };

  doc.autoTable({
    startY: y,
    head: [tableHeaders],
    body: rows,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 1.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
      cellPadding: 1.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles,
    didParseCell(hookData) {
      const cell = hookData && hookData.cell;
      const colIdx = cell && cell.column ? cell.column.index : (hookData && hookData.column ? hookData.column.index : undefined);
      const section = hookData ? hookData.section : undefined;
      if (section === 'body' && colIdx === col.category) {
        // One-word category tab in the first column: tire=black, wheel=blue,
        // part=orange.
        const cat = String(cell.raw || '').toLowerCase();
        if (cat === 'wheel') cell.textColor = [32, 86, 185];
        else if (cat === 'part') cell.textColor = [214, 80, 41];
        else if (cat === 'service') cell.textColor = [22, 130, 93];
        else cell.textColor = [40, 40, 40];
      }
    },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 10;

  // === PRICING BREAKDOWN NOTE ===
  // NOTE: the travel surcharge is intentionally not called out as big bold
  // text after the table — it is folded into the small breakdown paragraph
  // below (and a short bullet in the notes) to stay factual and low-key.
  if (y < 235) {
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Pricing Breakdown:', margin, y);
    y += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const breakdownNote = includeInstallation
      ? `Quote covers ${quantity} item(s); installation applies to ${installQty} of the installable tires. Each price includes item cost (pre-tax) + installation (pre-tax, where applicable) + 14% HST on both. HST applies to installation.${travelSurcharge > 0 ? ` A travel surcharge of ${formatCurrency(travelSurcharge)} applies per job.` : ''}`
      : `Each price includes: item cost + 14% HST. Installation not included.`;

    const breakdownLines = doc.splitTextToSize(breakdownNote, pageWidth - margin * 2);
    breakdownLines.forEach(line => {
      doc.text(line, margin, y);
      y += 3;
    });
    y += 2;
  }

  // === PRICING NOTES ===
  if (y < 245) {
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Pricing Notes:', margin, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const notes = [];

    // Installation-service line items (customer-supplied tires)
    tires.filter(t => t.isService).forEach(t => {
      notes.push(`• ${t.brand} ${t.model}: ${t.serviceDesc || 'installation'} — ${formatCurrency(t.servicePerUnit || 0)} per ${t.serviceUnit || 'tire'} × ${t.serviceQty || 1} ${t.serviceUnit || 'tire'}${(t.serviceQty || 1) === 1 ? '' : 's'}, quoted as one job`);
    });

    // Only add installation notes if installation is included
    if (includeInstallation) {
      notes.push(`• Installation includes off-rims mounting, balancing, and valve stems`);
      if (buyFromQuickRev) {
        notes.push(`• 10% installation discount applied when purchasing from QuickRev`);
      } else {
        notes.push(`• Installation rates shown are for tires purchased elsewhere`);
      }
    } else {
      notes.push(`• Installation not included — ask for installation rates`);
    }

    // TPMS sensors: flat per-sensor programming fee (different from tire install rates)
    // Only mention it when the TPMS fee is NOT overridden per-item.
    if (tires.some(t => isTpmsItem(t) && (t.installFee == null || t.installFee === ''))) {
      notes.push(`• TPMS sensor programming: ${formatCurrency(TPMS_PROGRAM_FEE)} per sensor (flat rate)`);
    }

    // Sale notes — active sales (with period + regular price) and pending sales
    onSaleRows.forEach(row => {
      notes.push(`• ${row.label}: on sale ${formatCurrency(row.salePrice)} (regular ${formatCurrency(row.regularPrice)})${row.end ? ` until ${row.end.toLocaleDateString()}` : ''} — regular price applies after the sale ends`);
    });
    pendingSaleRows.forEach(row => {
      const s = row.sale;
      notes.push(`• ${row.label}: sale of ${formatCurrency(s.salePrice)} ${s.saleEnd && s.saleEnd < new Date() ? `ended ${s.saleEnd.toLocaleDateString()}` : `starts ${s.saleStart ? s.saleStart.toLocaleDateString() : 'soon'}`} — regular price applies now`);
    });

    // Free items note
    tires.forEach(t => {
      if (t && t.isFree) notes.push(`• ${t.brand} ${t.model} (${t.size}): free item`);
    });

    // Travel surcharge note
    if (travelSurcharge > 0) {
      notes.push(`• Travel surcharge of ${formatCurrency(travelSurcharge)} applies${postalCode ? ` for postal code ${postalCode.toUpperCase()}` : ''} — per job, not per tire`);
    } else if (postalCode) {
      notes.push(`• No travel surcharge for postal code ${postalCode.toUpperCase()}`);
    }

    notes.push(`• Stock levels are estimates and subject to change`);

    notes.forEach(note => {
      const lines = doc.splitTextToSize(note, pageWidth - margin * 2);
      lines.forEach(line => {
        doc.text(line, margin, y);
        y += 4;
      });
    });

    y += 3;
  }

  // === FOOTER ===
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, 280);
  doc.text('QuickRev Inc. | quickrev.ca', pageWidth - margin, 280, { align: 'right' });

  // Save
  const sizeLabel = (tireSize || 'quote').replace(/[^0-9a-zA-Z-]/g, '-');
  const filename = `QuickRev-Options-${sizeLabel}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}