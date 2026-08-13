import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import {
  calculateRetailPrice,
  calculateHST,
  calculateTireTotal,
  calculateInstallationPerTire,
  parseTireSize,
  formatCurrency,
  HST_RATE,
} from '../data/distributors.js';

/**
 * Generate a PDF showing available tire options and estimated costs
 * FIXED: Installation now included in HST calculation
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
  y += 10;

  // === DISCLAIMER ===
  doc.setFillColor(254, 252, 232);
  doc.roundedRect(margin, y - 4, pageWidth - margin * 2, 10, 2, 2, 'F');
  doc.setTextColor(180, 83, 9);
  doc.setFontSize(8);
  doc.text('This document shows estimated costs for available tire options. Prices are subject to change. Not an invoice.', margin + 3, y + 2);
  y += 14;

  // === TABLE DATA (FIXED: Separated columns for Price, Install, HST, Total) ===
  const tableHeaders = [
    'Brand',
    'Model',
    'Size',
    'Season',
    'Stock',
    'Price/Tire',
    includeInstallation ? 'Install/Tire' : '',
    'HST (14%)',
    'Total',
  ];

  const tableData = tires.map(tire => {
    const parsed = parseTireSize(tire.size);
    
    // Tire-only price (pre-tax, per tire)
    const tirePrice = calculateRetailPrice(tire.wholesale);
    const tireTaxInclusive = calculateTireTotal(tire.wholesale);
    
    let installPerTire = 0;
    let totalHST;
    let grandTotal;

    if (includeInstallation && parsed) {
      installPerTire = calculateInstallationPerTire(
        parsed.width, parsed.aspect, parsed.rim, vehicleType, buyFromQuickRev
      );
      // Installation applies only to the number of tires to be installed (installQty)
      const installTotal = installPerTire * installQty;
      totalHST = (tirePrice * quantity + installTotal) * HST_RATE;
      grandTotal = tirePrice * quantity + installTotal + totalHST;
    } else {
      totalHST = calculateHST(tire.wholesale) * quantity;
      grandTotal = tireTaxInclusive * quantity;
    }

    return [
      tire.brand,
      tire.model,
      tire.size,
      tire.season,
      tire.stock.toString(),
      formatCurrency(tirePrice),  // Tire price only (pre-tax)
      includeInstallation ? formatCurrency(installPerTire) : '',  // Installation only (per tire)
      formatCurrency(totalHST),   // HST on tires (× quantity) + installation (× installQty)
      formatCurrency(grandTotal), // Grand total for the whole quote
    ];
  });

  doc.autoTable({
    startY: y,
    head: [tableHeaders],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'center',
    },
    bodyStyles: {
      fontSize: 9,
      textColor: [30, 41, 59],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 20 },  // Brand
      1: { cellWidth: 28 },  // Model
      2: { cellWidth: 24, halign: 'center' },  // Size (wider to prevent wrapping)
      3: { cellWidth: 22, halign: 'center' },  // Season (wider to prevent wrapping)
      4: { cellWidth: 12, halign: 'center' },  // Stock
      5: { cellWidth: 18, halign: 'right' },  // Price/Tire
      6: { cellWidth: 18, halign: 'right' },  // Install/Tire (if included)
      7: { cellWidth: 16, halign: 'right' },  // HST (14%)
      8: { cellWidth: 18, halign: 'right' },  // Total
    },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 10;

  // === PRICING BREAKDOWN NOTE (NEW) ===
  if (y < 240) {
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Pricing Breakdown:', margin, y);
    y += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const breakdownNote = includeInstallation
      ? `Quote covers ${quantity} tire(s); installation applies to ${installQty} of them. Each price includes tire cost (pre-tax) + installation (pre-tax) + 14% HST on both. HST applies to installation.`
      : `Each price includes: tire cost + 14% HST. Installation not included.`;
    
    const breakdownLines = doc.splitTextToSize(breakdownNote, pageWidth - margin * 2);
    breakdownLines.forEach(line => {
      doc.text(line, margin, y);
      y += 3;
    });
    y += 2;
  }

  // === PRICING NOTES ===
  if (y < 250) {
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
    
    notes.push(`• Stock levels are estimates and subject to change`);

    notes.forEach(note => {
      doc.text(note, margin, y);
      y += 4;
    });

    y += 3;
  }

  // === SERVICE AREA NOTE (NEW) ===
  if (y < 265) {
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin, y - 3, pageWidth - margin * 2, 11, 1.5, 1.5, 'F');
    
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Service Area Note:', margin + 2, y + 1);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Extra travel charges may apply for suburban/rural areas. For more information, visit: quickrev.ca/services-pricing', margin + 2, y + 5);
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