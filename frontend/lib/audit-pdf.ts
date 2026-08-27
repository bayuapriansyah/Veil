/**
 * VEIL Audit PDF Generator — Clean Minimalist Design
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AuditTx, txShort } from './veil-client';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function formatNow(): string {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function header(doc: jsPDF, txCount: number, generatedAt: string): number {
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, w, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text('VEIL', 20, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('Verifiable Economic Infrastructure Layer', 20, 24);

  doc.setDrawColor(200, 200, 200);
  doc.line(20, 28, w - 20, 28);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Audit Report  |  ${txCount} transactions  |  ${generatedAt}`, 20, 35);

  return 45;
}

function summary(doc: jsPDF, y: number, txs: AuditTx[]): number {
  const w = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('SUMMARY', 20, y);
  y += 2;

  doc.setDrawColor(200, 200, 200);
  doc.line(20, y, w - 20, y);
  y += 6;

  const verified = txs.filter(t => t.verificationStatus === 'payment-verified fulfillment-verified').length;
  const settled = txs.filter(t => t.settlementStatus === 'released' || t.settlementStatus === 'settled').length;
  const proving = txs.filter(t => t.attestationStatus === 'proving').length;
  const mirror = txs.filter(t => t.attestationStatus === 'mirror').length;

  const rows = [
    ['Total transactions', String(txs.length)],
    ['Verified', String(verified)],
    ['Settled', String(settled)],
    ['Proving (pending attestation)', String(proving)],
    ['Mirror (no on-chain record)', String(mirror)],
  ];

  autoTable(doc, {
    startY: y,
    body: rows,
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 2, textColor: [60, 60, 60] },
    columnStyles: { 0: { cellWidth: 80, fontStyle: 'bold' }, 1: { cellWidth: 30, halign: 'right' } },
    margin: { left: 20, right: 20 },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

function txTable(doc: jsPDF, y: number, txs: AuditTx[]): number {
  const w = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('TRANSACTIONS', 20, y);
  y += 2;

  doc.setDrawColor(200, 200, 200);
  doc.line(20, y, w - 20, y);
  y += 4;

  const rows = txs.map(t => [
    txShort(t.txId),
    t.verificationStatus,
    t.settlementStatus,
    t.attestationStatus.toUpperCase(),
    t.sourceTx ? txShort(t.sourceTx) : 'not recorded',
    t.attestationTx ? txShort(t.attestationTx) : 'pending',
    formatDate(t.createdAt),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Order', 'Verification', 'Settlement', 'Attestation', 'Source', 'CC3', 'Time']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2.5, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.3 },
    headStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 7, lineColor: [200, 200, 200] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 28 },
      2: { cellWidth: 22 },
      3: { cellWidth: 25 },
      4: { cellWidth: 22 },
      5: { cellWidth: 22 },
      6: { cellWidth: 40 },
    },
    margin: { left: 20, right: 20 },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

function explorerLinks(doc: jsPDF, y: number, txs: AuditTx[]): number {
  const w = doc.internal.pageSize.getWidth();

  if (y > 250) { doc.addPage(); y = 25; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('ON-CHAIN VERIFICATION', 20, y);
  y += 2;

  doc.setDrawColor(200, 200, 200);
  doc.line(20, y, w - 20, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);

  const lines: string[] = [];
  txs.forEach(t => {
    if (t.sourceTx) {
      lines.push(`${txShort(t.txId)}  Source   sepolia.etherscan.io/tx/${t.sourceTx}`);
    } else {
      lines.push(`${txShort(t.txId)}  Source   not recorded (soft-fail)`);
    }
    if (t.attestationTx) {
      lines.push(`${txShort(t.txId)}  Prove    blockscout.cc3-testnet.creditcoin.network/tx/${t.attestationTx}`);
    } else {
      lines.push(`${txShort(t.txId)}  Prove    pending worker proof`);
    }
    if (t.settlementTx) {
      lines.push(`${txShort(t.txId)}  Settle   blockscout.cc3-testnet.creditcoin.network/tx/${t.settlementTx}`);
    }
  });

  if (lines.length === 0) {
    doc.text('No on-chain transactions recorded.', 20, y);
    return y + 8;
  }

  lines.forEach((line, i) => {
    if (y + i * 5 > 275) { doc.addPage(); y = 25; }
    doc.text(line, 20, y + i * 5);
  });

  return y + lines.length * 5 + 8;
}

function boundary(doc: jsPDF, y: number): number {
  const w = doc.internal.pageSize.getWidth();

  if (y > 200) { doc.addPage(); y = 25; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('PRIVACY BOUNDARY', 20, y);
  y += 2;

  doc.setDrawColor(200, 200, 200);
  doc.line(20, y, w - 20, y);
  y += 6;

  const text = [
    'This report contains PUBLIC audit register data only.',
    '',
    'Sealed data (amounts, agents, evidence) requires authorized auditor disclosure.',
    'All on-chain transactions are independently verifiable on Sepolia and Creditcoin CC3.',
    'Attestation verifies cross-chain facts; it does not grant privacy.',
    'Privacy is provided by the AES-256-GCM encrypted audit vault.',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);

  text.forEach((line, i) => {
    if (y + i * 4.5 > 275) { doc.addPage(); y = 25; }
    doc.text(line, 20, y + i * 4.5);
  });

  return y + text.length * 4.5 + 8;
}

function footer(doc: jsPDF, page: number, total: number): void {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  doc.setDrawColor(200, 200, 200);
  doc.line(20, h - 18, w - 20, h - 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('VEIL Audit Report', 20, h - 13);
  doc.text(`${page} / ${total}`, w - 20, h - 13, { align: 'right' });
}

export async function generateAuditPDF(txs: AuditTx[]): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = header(doc, txs.length, formatNow());
  y = summary(doc, y, txs);
  y = txTable(doc, y, txs);
  y = explorerLinks(doc, y, txs);
  y = boundary(doc, y);

  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    footer(doc, i, total);
  }

  doc.save(`VEIL-Audit-${new Date().toISOString().split('T')[0]}.pdf`);
}
