/**
 * Token-bucket rate limiter for API calls
 */
class RateLimiter {
  constructor(requestsPerMinute) {
    this.interval = (60 * 1000) / requestsPerMinute;
    this.lastCall = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.interval) {
      await new Promise(resolve => setTimeout(resolve, this.interval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

module.exports = { RateLimiter };
