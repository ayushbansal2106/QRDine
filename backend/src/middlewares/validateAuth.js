const AppError = require('../utils/AppError');

const isValidEmail = (value) =>
  typeof value === 'string' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());

const validateOwnerRegistration = (req, res, next) => {
  const { ownerName, ownerEmail, password, cafe } = req.body;
  const errors = [];

  if (!ownerName || typeof ownerName !== 'string' || !ownerName.trim()) {
    errors.push('Owner name is required');
  }

  if (!ownerEmail || !isValidEmail(ownerEmail)) {
    errors.push('A valid owner email is required');
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }

  if (!cafe || typeof cafe !== 'object') {
    errors.push('Cafe details are required');
  } else {
    if (!cafe.name || typeof cafe.name !== 'string' || !cafe.name.trim()) {
      errors.push('Cafe name is required');
    }

    if (cafe.email && !isValidEmail(cafe.email)) {
      errors.push('Cafe email must be valid');
    }
  }

  if (errors.length > 0) {
    return next(new AppError(errors.join('. '), 400));
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { email, ownerEmail, password } = req.body;
  const loginEmail = email || ownerEmail;
  const errors = [];

  if (!loginEmail || !isValidEmail(loginEmail)) {
    errors.push('A valid email is required');
  }

  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
  }

  if (errors.length > 0) {
    return next(new AppError(errors.join('. '), 400));
  }

  next();
};

module.exports = { validateOwnerRegistration, validateLogin };
