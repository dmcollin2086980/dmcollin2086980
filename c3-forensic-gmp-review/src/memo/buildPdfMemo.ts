import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Finding, PayApplication, ProjectProfile } from '../engine/types';
import { formatUsd } from '../format';
import {
  DISCLAIMER,
  SEVERITY_LABEL,
  stripEmDash,
  type BuildMemoOptions,
} from './buildMarkdownMemo';

// 0.75" all sides on Letter (612 x 792 points at 72dpi).
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN;

const LINE_HEIGHT = {
  title: 22,
  h2: 16,
  h3: 14,
  body: 12,
};

interface Cursor {
  y: number;
}

const ensureRoom = (doc: jsPDF, cursor: Cursor, needed: number): void => {
  if (cursor.y + needed > BOTTOM_LIMIT) {
    doc.addPage();
    cursor.y = MARGIN;
  }
};

const addParagraph = (
  doc: jsPDF,
  cursor: Cursor,
  text: string,
  fontSize: number,
  lineHeight: number,
): void => {
  doc.setFontSize(fontSize);
  const lines: string[] = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  for (const line of lines) {
    ensureRoom(doc, cursor, lineHeight);
    doc.text(line, MARGIN, cursor.y);
    cursor.y += lineHeight;
  }
};

const addLabelValue = (
  doc: jsPDF,
  cursor: Cursor,
  label: string,
  value: string,
): void => {
  ensureRoom(doc, cursor, LINE_HEIGHT.body);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const labelText = `${label}: `;
  doc.text(labelText, MARGIN, cursor.y);
  const labelWidth = doc.getTextWidth(labelText);
  doc.setFont('helvetica', 'normal');
  doc.text(value, MARGIN + labelWidth, cursor.y);
  cursor.y += LINE_HEIGHT.body;
};

const addSectionHeading = (doc: jsPDF, cursor: Cursor, text: string): void => {
  cursor.y += 6;
  ensureRoom(doc, cursor, LINE_HEIGHT.h2 + 4);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(text, MARGIN, cursor.y);
  cursor.y += LINE_HEIGHT.h2;
  doc.setFont('helvetica', 'normal');
};

const addSubHeading = (doc: jsPDF, cursor: Cursor, text: string): void => {
  cursor.y += 4;
  ensureRoom(doc, cursor, LINE_HEIGHT.h3 + 4);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(stripEmDash(text), MARGIN, cursor.y);
  cursor.y += LINE_HEIGHT.h3;
  doc.setFont('helvetica', 'normal');
};

const buildHeader = (
  doc: jsPDF,
  cursor: Cursor,
  profile: ProjectProfile,
  payApp: PayApplication,
  preparedBy: string | undefined,
  now: Date,
): void => {
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('C3 Forensic GMP Review', MARGIN, cursor.y);
  cursor.y += LINE_HEIGHT.title;
  doc.setFont('helvetica', 'normal');

  addLabelValue(doc, cursor, 'Project', profile.projectName.trim() || '(not specified)');
  addLabelValue(doc, cursor, 'Pay Application', `#${payApp.applicationNumber}`);
  addLabelValue(doc, cursor, 'Period ending', payApp.periodTo.trim() || '(not set)');
  addLabelValue(doc, cursor, 'Prepared by', (preparedBy ?? '').trim() || '(not specified)');
  addLabelValue(doc, cursor, 'Prepared on', now.toISOString().slice(0, 10));
};

const buildSummary = (
  doc: jsPDF,
  cursor: Cursor,
  payApp: PayApplication,
  result: BuildMemoOptions['result'],
): void => {
  addSectionHeading(doc, cursor, 'Summary');
  if (result.findings.length === 0) {
    addParagraph(
      doc,
      cursor,
      `This forensic review of Pay Application #${payApp.applicationNumber} identifies no findings against the contract terms encoded in the Project Profile.`,
      10,
      LINE_HEIGHT.body,
    );
    return;
  }
  const { counts, totalExposure, findings } = result;
  addParagraph(
    doc,
    cursor,
    `This forensic review of Pay Application #${payApp.applicationNumber} identifies ${findings.length} finding(s) against the contract terms encoded in the Project Profile: ${counts.high} high, ${counts.medium} medium, ${counts.low} low. Estimated total exposure across high and medium findings is ${formatUsd(totalExposure)}.`,
    10,
    LINE_HEIGHT.body,
  );
};

const buildFindingsTable = (
  doc: jsPDF,
  cursor: Cursor,
  findings: Finding[],
): void => {
  if (findings.length === 0) return;
  addSectionHeading(doc, cursor, 'Findings');
  autoTable(doc, {
    startY: cursor.y,
    margin: { left: MARGIN, right: MARGIN },
    head: [
      [
        'Severity',
        'Rule',
        'Title',
        'Affected lines',
        'Dollar exposure',
        'Contract basis',
        'Recommended action',
      ],
    ],
    body: findings.map((f) => [
      SEVERITY_LABEL[f.severity],
      f.ruleId,
      stripEmDash(f.title),
      f.affectedLineItems.join(', '),
      formatUsd(f.dollarExposure),
      stripEmDash(f.contractBasis),
      stripEmDash(f.recommendedAction),
    ]),
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
  });
  // jspdf-autotable mutates the doc with `lastAutoTable.finalY`. Its TS types
  // augment jsPDF but the module's `default` export does not surface it on the
  // instance type, so we read it through a narrowed cast.
  const finalY =
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? cursor.y;
  cursor.y = finalY + 8;
};

const buildDetailedFinding = (
  doc: jsPDF,
  cursor: Cursor,
  f: Finding,
  position: number,
): void => {
  const heading = `${position}. ${f.title} (${SEVERITY_LABEL[f.severity]}, ${formatUsd(f.dollarExposure)})`;
  addSubHeading(doc, cursor, heading);
  addLabelValue(doc, cursor, 'Rule', f.ruleId);
  addLabelValue(doc, cursor, 'Contract basis', stripEmDash(f.contractBasis));
  addLabelValue(
    doc,
    cursor,
    'Affected lines',
    f.affectedLineItems.length > 0 ? f.affectedLineItems.join(', ') : '(none)',
  );
  cursor.y += 2;
  addParagraph(doc, cursor, stripEmDash(f.explanation), 10, LINE_HEIGHT.body);
  cursor.y += 2;
  addParagraph(
    doc,
    cursor,
    `Recommended action: ${stripEmDash(f.recommendedAction)}`,
    10,
    LINE_HEIGHT.body,
  );
};

const buildDetailedFindings = (
  doc: jsPDF,
  cursor: Cursor,
  findings: Finding[],
): void => {
  const detailed = findings.filter(
    (f) => f.severity === 'high' || f.severity === 'medium',
  );
  if (detailed.length === 0) return;
  addSectionHeading(doc, cursor, 'Detailed findings');
  detailed.forEach((f, i) => buildDetailedFinding(doc, cursor, f, i + 1));
};

const buildDisclaimer = (doc: jsPDF, cursor: Cursor): void => {
  addSectionHeading(doc, cursor, 'Disclaimer');
  addParagraph(doc, cursor, DISCLAIMER, 10, LINE_HEIGHT.body);
};

const addFooters = (doc: jsPDF): void => {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Page ${i} of ${pageCount}`,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - MARGIN / 2,
      { align: 'right' },
    );
  }
};

export const buildPdfMemo = ({
  profile,
  payApp,
  result,
  preparedBy,
  now = new Date(),
}: BuildMemoOptions): Blob => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: false });
  doc.setCreationDate(now);
  doc.setProperties({ title: 'C3 Forensic GMP Review' });

  const cursor: Cursor = { y: MARGIN };
  buildHeader(doc, cursor, profile, payApp, preparedBy, now);
  buildSummary(doc, cursor, payApp, result);
  buildFindingsTable(doc, cursor, result.findings);
  buildDetailedFindings(doc, cursor, result.findings);
  buildDisclaimer(doc, cursor);
  addFooters(doc);

  return doc.output('blob');
};
