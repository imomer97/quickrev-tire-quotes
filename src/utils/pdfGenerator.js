import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import {
  calculateInstallationPerTire,
  parseTireSize,
  formatCurrency,
  HST_RATE,
  getRegularPrice,
  getSaleInfo,
  getEffectiveRetail,
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
  vehicleType = 'sedan',
  buyFromQuickRev = true,
  includeInstallation = true,
  customerName = '',
  tireSize = '',
  installQty = quantity,
  postalCode = '',
  travelSurcharge = 0,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  // === HEADER ===
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 35, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('QUICKREV', margin, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Tire Options & Estimated Costs', margin, 26);
  doc.text('quickrev.ca', pageWidth - margin, 26, { align: 'right' });

  y = 42;

  // === CUSTOMER INFO ===
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(customerName || '_________________________', margin + 30, y);
  y += 6;

  // New tires with the number of tires to be installed shown beside them
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('New Tires:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(tireSize || '_________________________', margin + 24, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Tires to be Installed:', 115, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${installQty}`, 115 + 44, y);
  doc.setFontSize(11);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Quantity:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${quantity} tires`, margin + 30, y);
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
  doc.text('This document shows estimated costs for available tire options. Prices are subject to change. Not an invoice.', margin + 3, y + 2);
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
    includeInstallation && t.includeInstall !== false && parseTireSize(t.size)
  );
  const showInstallCol = includeInstallation && anyInstall;

  const rows = tires.map(tire => {
    const parsed = parseTireSize(tire.size);

    // Sale-aware pricing (matches the item cards). Free items price at $0.
    const tirePrice = getEffectiveRetail(tire);
    const regularPrice = getRegularPrice(tire);
    const sale = getSaleInfo(tire);

    // Installation only when the item is installable AND the item didn't opt
    // out (wheels/rims/sensors/lug nuts set includeInstall = false).
    const installEligible = includeInstallation && tire.includeInstall !== false && parsed;
    let installPerTire = 0;
    let totalHST;
    let grandTotal;

    if (installEligible) {
      installPerTire = calculateInstallationPerTire(
        parsed.width, parsed.aspect, parsed.rim, vehicleType, buyFromQuickRev
      );
      // Installation applies only to the number of tires to be installed (installQty)
      const installTotal = installPerTire * installQty;
      const preTax = tirePrice * quantity + installTotal;
      totalHST = preTax * HST_RATE;
      grandTotal = preTax + totalHST;
    } else {
      const preTax = tirePrice * quantity;
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

    const row = [
      tire.brand,
      tire.model,
      tire.size,
      tire.season || '—',
      tire.stock.toString(),
      formatCurrency(tirePrice),  // effective price (sale while active, else regular)
    ];
    if (showPeriod) row.push(salePeriod);               // e.g. "Aug 1 – 15" or "until Aug 15"
    if (showInstallCol) row.push(installPerTire > 0 ? formatCurrency(installPerTire) : '—');  // Installation only (per tire)
    row.push(formatCurrency(totalHST), formatCurrency(grandTotal));
    return row;
  });

  // === TABLE HEADERS ===
  const tableHeaders = ['Brand', 'Model', 'Size', 'Season', 'Stock', 'Price/Tire'];
  if (showPeriod) tableHeaders.push('Sale Period');
  if (showInstallCol) tableHeaders.push('Install/Tire');
  tableHeaders.push('HST (14%)', 'Total');

  // Fixed widths keep headers / season / size / price from wrapping the text.
  // Model (index 1) auto-sizes to whatever width remains on the page.
  const col = { brand: 0, model: 1, size: 2, season: 3, stock: 4, price: 5 };
  let next = 6;
  if (showPeriod) col.period = next++;
  if (showInstallCol) col.install = next++;
  col.hst = next++;
  col.total = next++;

  const columnStyles = {
    [col.brand]: { cellWidth: 18 },
    [col.size]: { cellWidth: 22 },
    [col.season]: { cellWidth: 20 },
    [col.stock]: { cellWidth: 10 },
    [col.price]: { cellWidth: 18 },
  };
  if (showPeriod) columnStyles[col.period] = { cellWidth: 26 };
  if (showInstallCol) columnStyles[col.install] = { cellWidth: 22 };
  columnStyles[col.hst] = { cellWidth: 16 };
  columnStyles[col.total] = { cellWidth: 18 };

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
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 10;

  // === TRAVEL SURCHARGE LINE (per job, not per tire) ===
  if (includeInstallation && travelSurcharge > 0 && y < 235) {
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`Travel surcharge (per job): ${formatCurrency(travelSurcharge)}`, margin, y);
    y += 6;
  }

  // === PRICING BREAKDOWN NOTE ===
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

    // Only add installation notes if installation is included
    if (includeInstallation) {
      notes.push(`• Installation includes off-rims mounting, balancing, and valve stems`);
      if (buyFromQuickRev) {
        notes.push(`• 10% installation discount applied when purchasing tires from QuickRev`);
      } else {
        notes.push(`• Installation rates shown are for tires purchased elsewhere`);
      }
    } else {
      notes.push(`• Installation not included — ask for installation rates`);
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

  // === SERVICE AREA NOTE ===
  if (y < 265) {
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin, y - 3, pageWidth - margin * 2, 11, 1.5, 1.5, 'F');

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Service Area Note:', margin + 2, y + 1);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const serviceNote = travelSurcharge > 0
      ? `Travel surcharge of ${formatCurrency(travelSurcharge)} applies for this quote${postalCode ? ` (postal code ${postalCode.toUpperCase()})` : ''}.`
      : 'Extra travel charges may apply for suburban/rural areas. For more information, visit: quickrev.ca/services-pricing';
    doc.text(serviceNote, margin + 2, y + 5);
  }

  // === FOOTER ===
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, 280);
  doc.text('QuickRev Inc. | quickrev.ca', pageWidth - margin, 280, { align: 'right' });

  // Save
  const sizeLabel = (tireSize || 'quote').replace(/[^0-9a-zA-Z-]/g, '-');
  const filename = `QuickRev-Tire-Options-${sizeLabel}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}