const cloudinary = require('cloudinary').v2;
const env = require('../config/env');

/**
 * Configure Cloudinary SDK with credentials from environment.
 * Returns the configured cloudinary instance.
 */
const getCloudinary = () => {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    return null;
  }

  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
  });

  return cloudinary;
};

module.exports = { getCloudinary };
