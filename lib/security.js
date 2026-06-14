/**
 * lib/security.js — Security utilities cho REST API
 *
 * Bao gồm:
 * - Security headers (OWASP recommended)
 * - API key validation
 * - IP allowlist
 * - Body size check
 * - Audit logging
 * - Input sanitization
 */

/**
 * Lấy security headers cho response.
 * Based on OWASP Secure Headers Project.
 */
export function getSecurityHeaders() {
  return {
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',
    // XSS protection (legacy browsers)
    'X-XSS-Protection': '1; mode=block',
    // Force HTTPS
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    // CSP: only allow same-origin resources
    'Content-Security-Policy': "default-src 'self'",
    // Referrer policy: don't leak referrer to third parties
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Permissions policy: disable unnecessary browser features
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // Cross-origin isolation
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

/**
 * Validate API key từ Authorization header.
 */
export function validateApiKey(token) {
  const API_KEY = process.env.REST_API_KEY || 'change-me-in-production';
  if (!token || token !== API_KEY) return false;
  return true;
}

/**
 * Kiểm tra IP có được phép truy cập không.
 */
export function isIpAllowed(clientIp) {
  const allowedIps = (process.env.ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedIps.length === 0) return true; // No IP restriction
  return allowedIps.includes(clientIp);
}

/**
 * Kiểm tra body size có hợp lệ không.
 */
export function checkBodySize(contentLength) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (!contentLength) return { ok: true };
  const size = parseInt(contentLength, 10);
  if (size > maxSize) return { ok: false, error: 'Request body too large' };
  return { ok: true };
}

/**
 * Audit log cho security events.
 */
export function auditLog(req, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    method: req.method,
    path: req.url,
    ...details,
  };
  console.log('[AUDIT]', JSON.stringify(entry));
}

// ─── Input Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize string input: strip HTML tags, trim, limit length.
 * Prevents XSS and injection attacks.
 */
export function sanitizeString(input, maxLength = 2000) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')           // Strip HTML tags
    .replace(/[<>"'&]/g, '')           // Remove dangerous chars
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize an object's string values recursively.
 */
export function sanitizeObject(obj, maxLength = 2000) {
  if (!obj || typeof obj !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value, maxLength);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value, maxLength);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Validate request body against a simple schema.
 * Schema: { fieldName: { type: 'string'|'number'|'boolean', required?: boolean, maxLength?: number } }
 * Returns { ok: boolean, data: Object, errors: string[] }
 */
export function validateBody(body, schema) {
  const errors = [];
  const data = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field];

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rules.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${field} must be a string`);
      } else {
        data[field] = sanitizeString(value, rules.maxLength || 2000);
      }
    } else if (rules.type === 'number') {
      const num = Number(value);
      if (isNaN(num)) {
        errors.push(`${field} must be a number`);
      } else {
        data[field] = num;
      }
    } else if (rules.type === 'boolean') {
      data[field] = Boolean(value);
    } else if (rules.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${field} must be an array`);
      } else {
        data[field] = value;
      }
    } else {
      data[field] = value;
    }
  }

  return { ok: errors.length === 0, data, errors };
}
