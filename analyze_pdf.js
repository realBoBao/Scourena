/**
 * PDF Analysis Module
 * Extract text from PDF files and prepare for indexing.
 *
 * Usage: node analyze_pdf.js <pdf-path> [options]
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Analyze a PDF file — extract text and metadata.
 *
 * @param {string} pdfPath - Path to the PDF file
 * @param {Object} [options]
 * @param {string} [options.outputDir='./artifacts/pdf'] - Output directory
 * @returns {Promise<{title: string, pageCount: number, chunksCount: number, descriptionPath: string}>}
 */
export async function analyzePdf(pdfPath, options = {}) {
  const { outputDir = './artifacts/pdf' } = options;
  const fileName = path.basename(pdfPath);
  const title = fileName.replace(/\.pdf$/i, '');

  console.log(`[analyze_pdf] Processing: ${fileName}`);

  // Ensure output dir exists
  await fs.mkdir(outputDir, { recursive: true });

  // Extract text using pdf-parse
  let text = '';
  let pageCount = 0;
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const dataBuffer = await fs.readFile(pdfPath);
    const data = await pdfParse(dataBuffer);
    text = data.text || '';
    pageCount = data.numpages || 0;
  } catch (err) {
    console.error(`[analyze_pdf] pdf-parse failed: ${err.message}`);
    // Fallback: try pdftotext
    try {
      const { stdout } = await execFileAsync('pdftotext', [pdfPath, '-']);
      text = stdout;
    } catch {
      console.error('[analyze_pdf] pdftotext also failed');
    }
  }

  // Save extracted text
  const descriptionPath = path.join(outputDir, `${title}.txt`);
  await fs.writeFile(descriptionPath, text, 'utf8');

  // Chunk the text
  const chunks = chunkText(text, 600, 120);
  const chunksPath = path.join(outputDir, `${title}_chunks.json`);
  await fs.writeFile(chunksPath, JSON.stringify(chunks, null, 2), 'utf8');

  console.log(`[analyze_pdf] Extracted ${pageCount} pages, ${chunks.length} chunks`);

  return {
    title,
    pageCount,
    chunksCount: chunks.length,
    descriptionPath,
    chunksPath,
  };
}

/**
 * Simple text chunking.
 */
function chunkText(text, chunkSize = 600, overlap = 120) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    chunks.push(text.slice(i, end));
    i += chunkSize - overlap;
  }
  return chunks;
}

// CLI entry point
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: node analyze_pdf.js <pdf-path>');
    process.exit(1);
  }
  const result = await analyzePdf(pdfPath);
  console.log(JSON.stringify(result, null, 2));
}

export default analyzePdf;
