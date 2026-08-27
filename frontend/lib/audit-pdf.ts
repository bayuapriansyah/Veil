/**
 * VEIL Audit PDF Generator
 *
 * Generates a professional PDF audit report with:
 * - Executive summary
 * - Transaction table with explorer links
 * - Evidence bundles (if disclosed)
 * - Privacy boundary statement
 * - Cryptographic commitments
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AuditTx, txShort } from './veil-client';

const COLORS: Record<string, [number, number, number]> = {
  primary: [15, 23, 42],      // Slate-900
  accent: [34, 197, 94],       // Green-500
  muted: [100, 116, 139],      // Slate-500
  light: [241, 245, 249],      // Slate-100
  white: [255, 255, 255],
  verified: [22, 163, 74],     // Green-600
  pending: [234, 179, 8],      // Yellow-500
  failed: [220, 38, 38],       // Red-600
  border: [226, 232, 240],     // Slate-200
};

function c(name: string): [number, number, number] {
  return COLORS[name] ?? COLORS.muted;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function drawHeader(doc: jsPDF, y: number, txCount: number, generatedAt: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(c('primary')[0], c('primary')[1], c('primary')[2]);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(c('white')[0], c('white')[1], c('white')[2]);
  doc.text('VEIL', 20, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text('Verifiable Economic Infrastructure Layer', 20, 30);

  doc.setFillColor(c('accent')[0], c('accent')[1], c('accent')[2]);
  doc.roundedRect(pageWidth - 75, 12, 55, 8, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(c('white')[0], c('white')[1], c('white')[2]);
  doc.text('AUDIT REPORT', pageWidth - 68, 18);

  doc.setFontSize(9);
  doc.setTextColor(c('muted')[0], c('muted')[1], c('muted')[2]);
  doc.text(`Generated: ${generatedAt}`, 20, 40);
  doc.text(`Transactions: ${txCount}`, 20, 46);

  return 55;
}

function drawSummary(doc: jsPDF, y: number, txs: AuditTx[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(c('light')[0], c('light')[1], c('light')[2]);
  doc.roundedRect(15, y, pageWidth - 30, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(c('primary')[0], c('primary')[1], c('primary')[2]);
  doc.text('EXECUTIVE SUMMARY', 20, y + 7);

  y += 18;

  const verified = txs.filter(t => t.verificationStatus === 'payment-verified fulfillment-verified').length;
  const proving = txs.filter(t => t.attestationStatus === 'proving').length;
  const mirror = txs.filter(t => t.attestationStatus === 'mirror').length;
  const settled = txs.filter(t => t.settlementStatus === 'settled').length;

  const stats = [
    { label: 'Total', value: txs.length.toString(), color: c('primary') },
    { label: 'Verified', value: verified.toString(), color: c('verified') },
    { label: 'Proving', value: proving.toString(), color: c('pending') },
    { label: 'Mirror', value: mirror.toString(), color: c('muted') },
    { label: 'Settled', value: settled.toString(), color: c('verified') },
  ];

  const boxWidth = (pageWidth - 40) / stats.length;
  stats.forEach((stat, i) => {
    const x = 20 + i * boxWidth;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, boxWidth - 4, 20, 2, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(stat.color[0], stat.color[1], stat.color[2]);
    doc.text(stat.value, x + (boxWidth - 4) / 2, y + 10, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(c('muted')[0], c('muted')[1], c('muted')[2]);
    doc.text(stat.label, x + (boxWidth - 4) / 2, y + 16, { align: 'center' });
  });

  return y + 30;
}

function drawTransactionTable(doc: jsPDF, y: number, txs: AuditTx[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(c('light')[0], c('light')[1], c('light')[2]);
  doc.roundedRect(15, y, pageWidth - 30, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(c('primary')[0], c('primary')[1], c('primary')[2]);
  doc.text('TRANSACTION REGISTER', 20, y + 7);

  y += 15;

  const tableData = txs.map(t => [
    txShort(t.txId),
    t.commitment.slice(0, 12) + '...',
    t.verificationStatus,
    t.settlementStatus,
    t.attestationStatus.toUpperCase(),
    t.sourceTx ? `src ${txShort(t.sourceTx)}` : '-',
    t.attestationTx ? `cc3 ${txShort(t.attestationTx)}` : '-',
    formatDate(t.createdAt),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['TxId', 'Commitment', 'Verification', 'Settlement', 'Attestation', 'Source Tx', 'CC3 Tx', 'Timestamp']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 3,
      textColor: c('primary'),
      lineColor: c('border'),
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: c('primary'),
      textColor: c('white'),
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 28 },
      2: { cellWidth: 30 },
      3: { cellWidth: 22 },
      4: { cellWidth: 25 },
      5: { cellWidth: 28 },
      6: { cellWidth: 28 },
      7: { cellWidth: 35 },
    },
    margin: { left: 15, right: 15 },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
}

function drawExplorerLinks(doc: jsPDF, y: number, txs: AuditTx[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(c('light')[0], c('light')[1], c('light')[2]);
  doc.roundedRect(15, y, pageWidth - 30, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(c('primary')[0], c('primary')[1], c('primary')[2]);
  doc.text('BLOCKCHAIN EXPLORER LINKS', 20, y + 7);

  y += 15;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(c('muted')[0], c('muted')[1], c('muted')[2]);

  const links: string[] = [];
  txs.forEach(t => {
    if (t.sourceTx) {
      links.push(`Order ${txShort(t.txId)} — Source: https://sepolia.etherscan.io/tx/${t.sourceTx}`);
    }
    if (t.attestationTx) {
      links.push(`Order ${txShort(t.txId)} — Attestation: https://blockscout.cc3-testnet.creditcoin.network/tx/${t.attestationTx}`);
    }
    if (t.settlementTx) {
      links.push(`Order ${txShort(t.txId)} — Settlement: https://blockscout.cc3-testnet.creditcoin.network/tx/${t.settlementTx}`);
    }
  });

  if (links.length === 0) {
    doc.text('No on-chain transactions recorded yet.', 20, y + 5);
    return y + 12;
  }

  links.forEach((link, i) => {
    if (y + i * 6 > 270) {
      doc.addPage();
      y = 20;
    }
    doc.setTextColor(c('accent')[0], c('accent')[1], c('accent')[2]);
    doc.text(link, 20, y + i * 6);
  });

  return y + links.length * 6 + 10;
}

function drawPrivacyBoundary(doc: jsPDF, y: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  if (y > 240) {
    doc.addPage();
    y = 20;
  }

  doc.setFillColor(c('light')[0], c('light')[1], c('light')[2]);
  doc.roundedRect(15, y, pageWidth - 30, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(c('primary')[0], c('primary')[1], c('primary')[2]);
  doc.text('PRIVACY & VERIFICATION BOUNDARY', 20, y + 7);

  y += 15;

  const boundaryText = [
    'This audit report contains the PUBLIC audit register data from the VEIL system.',
    '',
    'SEALED DATA (requires authorized auditor disclosure):',
    '  - Agent addresses and provider identities',
    '  - Payment amounts and authorization details',
    '  - Fulfillment evidence and result hashes',
    '  - Settlement evidence and escrow status',
    '',
    'ON-CHAIN VERIFICATION:',
    '  - All source-chain transactions (Sepolia) are verifiable via Etherscan',
    '  - All attestation proofs (Creditcoin) are verifiable via Blockscout',
    '  - Settlement transactions are independently verifiable on CC3 testnet',
    '',
    'CRYPTOGRAPHIC COMMITMENTS:',
    '  - Each transaction includes a keccak256 commitment binding public facts',
    '  - Commitments are computed from verification status, policy status, and timestamp',
    '  - The AES-256-GCM sealed box contains encrypted protected data at rest',
    '',
    'ATTESTATION BOUNDARY:',
    '  - Attestcoin verifies cross-chain facts (payment/fulfillment/settlement)',
    '  - Attestation verifies facts — it does NOT grant privacy',
    '  - Privacy is provided by the audit vault\'s authenticated encryption',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  boundaryText.forEach((line, i) => {
    if (y + i * 5 > 270) {
      doc.addPage();
      y = 20;
    }
    if (line.startsWith('SEALED') || line.startsWith('ON-CHAIN') || line.startsWith('CRYPTO') || line.startsWith('ATTEST')) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(c('primary')[0], c('primary')[1], c('primary')[2]);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(c('muted')[0], c('muted')[1], c('muted')[2]);
    }
    doc.text(line, 20, y + i * 5);
  });

  return y + boundaryText.length * 5 + 10;
}

function drawFooter(doc: jsPDF, totalPages: number, currentPage: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setDrawColor(c('border')[0], c('border')[1], c('border')[2]);
  doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(c('muted')[0], c('muted')[1], c('muted')[2]);
  doc.text('VEIL Audit Report — Generated by Verifiable Economic Infrastructure Layer', 20, pageHeight - 15);
  doc.text('https://github.com/bayuapriansyah/Veil', 20, pageHeight - 11);
  doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth - 40, pageHeight - 15);
}

export async function generateAuditPDF(
  txs: AuditTx[],
  _options?: { disclosedData?: Record<string, unknown> }
): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const generatedAt = formatDate(Date.now());

  let y = drawHeader(doc, 10, txs.length, generatedAt);
  y = drawSummary(doc, y, txs);
  y = drawTransactionTable(doc, y, txs);
  y = drawExplorerLinks(doc, y, txs);
  y = drawPrivacyBoundary(doc, y);

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, totalPages, i);
  }

  const filename = `VEIL-Audit-Report-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
