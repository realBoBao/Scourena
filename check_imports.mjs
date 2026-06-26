#!/usr/bin/env node
/**
 * check_imports.mjs — Kiểm tra import các file đã xóa
 * Chạy: node check_imports.mjs
 */
import fs from 'fs';

// Các file đã xóa
const deletedFiles = [
  'backoff.js', 'chunking.js', 'circuit_breaker.js', 'curl_impersonate.js',
  'data_federation.js', 'document_parser.js', 'idempotency.js', 'load_shedder.js',
  'prompt_compressor.js', 'prompt_optimizer.js', 'request_coalescer.js',
  'request_hedging.js', 'rtk_filter.js', 'pngtuber_server.js', 'vad_state.js',
  'video_cdn.js', 'fetch_retry.js'
];

const dirs = ['./lib', './cron', './agents', './scripts', './tests'];
const allFiles = [];
for (const d of dirs) {
  if (fs.existsSync(d)) {
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.js')) allFiles.push(d + '/' + f);
    }
  }
}

// Check root files
for (const f of fs.readdirSync('.')) {
  if (f.endsWith('.js') && !f.startsWith('.')) allFiles.push('./' + f);
}

console.log('═'.repeat(60));
console.log('KIỂM TRA IMPORT CÁC FILE ĐÃ XÓA');
console.log('═'.repeat(60));

let foundIssues = 0;

for (const deletedFile of deletedFiles) {
  const importPath = `./lib/${deletedFile}`;
  const importPath2 = `../lib/${deletedFile}`;
  
  for (const filePath of allFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Check various import patterns
      const patterns = [
        `'${importPath}'`,
        `"${importPath}"`,
        `'${importPath2}'`,
        `"${importPath2}"`,
        `from '${importPath}'`,
        `from "${importPath}"`,
        `from '${importPath2}'`,
        `from "${importPath2}"`,
      ];
      
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          console.log(`\n❌ FOUND: ${filePath}`);
          console.log(`   Import: ${pattern}`);
          foundIssues++;
          break;
        }
      }
    } catch { /* skip */ }
  }
}

console.log('\n' + '═'.repeat(60));
if (foundIssues === 0) {
  console.log('✅ KHÔNG CÓ LỖI — Tất cả import đã được fix!');
} else {
  console.log(`❌ TÌM THẤY ${foundIssues} LỖI — Cần fix ngay!`);
}
console.log('═'.repeat(60));
