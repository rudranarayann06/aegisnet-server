require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initSocket } = require('./socket/socketHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const emergencyRoutes = require('./routes/emergency');
const aiRoutes = require('./routes/ai');
const responderRoutes = require('./routes/responder');
const analyticsRoutes = require('./routes/analytics');
const userRoutes = require('./routes/user');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket
initSocket(server);

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use('/api', generalLimiter);

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'AegisNet AI',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/emergency', emergencyRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/responder', responderRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/user', userRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
});

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[AegisNet] Server running on port ${PORT}`);
    console.log(`[AegisNet] Environment: ${process.env.NODE_ENV || 'development'}`);
  }
});

module.exports = { app, server };
