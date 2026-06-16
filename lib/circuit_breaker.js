/**
 * lib/circuit_breaker.js — Circuit breaker pattern for external APIs
 *
 * Tier 3: Fail-fast cho external APIs (OpenRouter, Gemini, Tavily)
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
 */

import { getLogger } from './logger.js';
const logger = getLogger('CircuitBreaker');

export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailure = null;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        logger.info(`[${this.name}] Circuit HALF_OPEN — testing...`);
      } else {
        throw new Error(`Circuit OPEN for ${this.name} — failing fast`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(`[${this.name}] Circuit OPEN after ${this.failures} failures`);
    }
  }

  getStats() {
    return { name: this.name, state: this.state, failures: this.failures };
  }
}

// Global breakers for external APIs
export const breakers = {
  openrouter: new CircuitBreaker('OpenRouter', { failureThreshold: 3, resetTimeout: 30000 }),
  gemini: new CircuitBreaker('Gemini', { failureThreshold: 3, resetTimeout: 30000 }),
  tavily: new CircuitBreaker('Tavily', { failureThreshold: 5, resetTimeout: 60000 }),
};
