import PDFDocument from 'pdfkit';

export interface ReceiptData {
  code: string;
  status: string;
  passengerName: string;
  passengerPhone: string;
  pickup: string;
  drop: string;
  scheduledAt: Date;
  vehicleCategory: string;
  estimatedKm: number;
  estimatedMin: number;
  fareTotal: number; // paise
  tokenAmount: number; // paise
  balanceAmount: number; // paise
  payments: { type: string; status: string; method: string | null; gatewayPayId: string | null; amountPaid: number; capturedAt: Date | null }[];
  cancellation: { bucket: string; feeAmount: number; refundAmount: number } | null;
}

const NAVY = '#1E2D5A';
const ORANGE = '#F48024';
const MUTED = '#6B6760';

function inr(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function maskPhone(phone: string): string {
  if (phone.length < 4) return phone;
  return phone.slice(0, -7).padEnd(phone.length - 4, 'X').replace(/\d/g, 'X') + phone.slice(-4);
}

/** Render a one-page PDF receipt and resolve with the full Buffer. */
export function generateReceiptPdf(d: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fillColor(ORANGE).fontSize(22).font('Helvetica-Bold').text('AERO SARATHI');
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text('Premium taxi service · Punjab');
    doc.moveDown(0.5);
    doc.fillColor(NAVY).fontSize(14).font('Helvetica-Bold').text('Booking Receipt');

    // Code + status row
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY).text(`Booking ${d.code}`, { continued: true });
    doc.font('Helvetica').fillColor(MUTED).text(`   ·   Status: ${d.status}`);
    doc.moveDown(0.5);
    line(doc);

    // Trip details
    section(doc, 'Trip');
    kv(doc, 'Passenger', `${d.passengerName} (${maskPhone(d.passengerPhone)})`);
    kv(doc, 'Pickup', d.pickup);
    kv(doc, 'Drop', d.drop);
    kv(doc, 'Scheduled', d.scheduledAt.toLocaleString('en-IN'));
    kv(doc, 'Vehicle', d.vehicleCategory);
    kv(doc, 'Estimate', `${d.estimatedKm.toFixed(1)} km · ${d.estimatedMin} min`);

    // Fare
    section(doc, 'Fare');
    kv(doc, 'Total fare', inr(d.fareTotal));
    kv(doc, 'Token (paid online)', inr(d.tokenAmount));
    kv(doc, 'Balance (pay driver)', inr(d.balanceAmount));

    // Payments
    if (d.payments.length) {
      section(doc, 'Payments');
      for (const p of d.payments) {
        kv(
          doc,
          `${p.type} · ${p.status}`,
          `${inr(p.amountPaid)}${p.method ? ` · ${p.method}` : ''}${p.gatewayPayId ? ` · ${p.gatewayPayId}` : ''}`,
        );
      }
    }

    // Cancellation
    if (d.cancellation) {
      section(doc, 'Cancellation');
      kv(doc, 'Policy', d.cancellation.bucket);
      kv(doc, 'Cancellation fee', inr(d.cancellation.feeAmount));
      kv(doc, 'Refunded', inr(d.cancellation.refundAmount));
    }

    // Footer
    doc.moveDown(1.5);
    line(doc);
    doc.moveDown(0.5);
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
      'Aero Sarathi · Indo Chariot Pvt Ltd · support@aerosarathi.com\nThis is a system-generated receipt and does not require a signature.',
    );

    doc.end();
  });
}

function line(doc: PDFKit.PDFDocument): void {
  doc.strokeColor('#E5E2DC').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.8);
  doc.fillColor(ORANGE).fontSize(11).font('Helvetica-Bold').text(title.toUpperCase());
  doc.moveDown(0.2);
}

function kv(doc: PDFKit.PDFDocument, key: string, value: string): void {
  const y = doc.y;
  doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(key, 50, y, { width: 150 });
  doc.fillColor(NAVY).fontSize(10).font('Helvetica').text(value, 210, y, { width: 335 });
  doc.moveDown(0.2);
}
