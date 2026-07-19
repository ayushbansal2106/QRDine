const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const menuRoutes = require('./routes/menuRoutes');
const tableRoutes = require('./routes/tableRoutes');
const orderRoutes = require('./routes/orderRoutes');
const requestRoutes = require('./routes/requestRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const billingRoutes = require('./routes/billingRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const cafeRoutes = require('./routes/cafeRoutes');
const userRoutes = require('./routes/userRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const swaggerSpec = require('./docs/swaggerSpec');
const { notFound, errorHandler } = require('./middlewares/errorMiddleware');

const env = require('./config/env');

const app = express();

// CORS: Restrict to frontend origin in production
app.use(cors({
  origin: env.nodeEnv === 'production'
    ? env.frontendUrl
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));

// Parse cookies (needed for CSRF token validation)
app.use(cookieParser());

// Security headers
app.use(helmet());

// Body parser with size limit (prevents large payload DoS)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Serve static files (invoice PDFs)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/cafe', cafeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);


app.use(notFound);
app.use(errorHandler);

module.exports = app;
