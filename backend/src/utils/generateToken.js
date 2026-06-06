const jwt = require('jsonwebtoken');
const env = require('../config/env');

const generateToken = (payload) =>
  jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

module.exports = generateToken;
