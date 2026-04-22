const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req) => process.env.NODE_ENV === 'development',
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI endpoint rate limit exceeded. Max 10 requests/minute.' },
  keyGenerator: (req) => req.user?.uid || req.ip,
  skip: (req) => process.env.NODE_ENV === 'development',
});

const emergencyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Emergency report rate limit exceeded.' },
  skip: (req) => process.env.NODE_ENV === 'development',
});

module.exports = { generalLimiter, aiLimiter, emergencyLimiter };
