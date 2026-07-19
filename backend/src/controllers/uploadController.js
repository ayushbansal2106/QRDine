const path = require('path');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getCloudinary } = require('../utils/cloudinary');

// Allowed image MIME types
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Upload an image file to Cloudinary.
 * Expects req.file from multer middleware.
 */
const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No image file provided. Please select a file to upload.', 400);
  }

  // Validate MIME type
  if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
    throw new AppError(
      'Invalid file type. Allowed types: JPEG, PNG, WebP, GIF.',
      400
    );
  }

  const cloudinary = getCloudinary();

  if (!cloudinary) {
    // Fallback: If Cloudinary is not configured, save locally or return error
    throw new AppError(
      'Image upload service is not configured. Please set CLOUDINARY credentials or use an image URL instead.',
      501
    );
  }

  // Upload to Cloudinary with folder prefix
  const result = await cloudinary.uploader.upload(req.file.path, {
    folder: 'qrdine/menu-items',
    use_filename: true,
    unique_filename: true,
    resource_type: 'image',
    transformation: [
      { width: 800, height: 600, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
    ],
  });

  // Return the secure Cloudinary URL
  res.status(200).json({
    success: true,
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
  });
});

module.exports = { uploadImage };
