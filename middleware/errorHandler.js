module.exports = function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    console.error('[Error]', err.message, err.stack);
  }

  // Validation errors
  if (err.type === 'validation') {
    return res.status(400).json({ error: 'Validation failed', details: err.details });
  }

  // Firebase errors
  if (err.code?.startsWith('auth/')) {
    return res.status(401).json({ error: 'Authentication error', code: err.code });
  }

  // Gemini API errors
  if (err.message?.includes('GoogleGenerativeAI')) {
    return res.status(502).json({ error: 'AI service temporarily unavailable', retry: true });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  res.status(status).json({
    error: message,
    ...(isDev && { stack: err.stack }),
  });
};
