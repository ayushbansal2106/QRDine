const fs = require('fs').promises;
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getCloudinary } = require('../utils/cloudinary');

// Allowed image MIME types
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Remove the multer temp file. Runs on both success and failure paths so
 * backend/uploads/temp cannot grow without bound.
 */
const cleanupTempFile = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    // ENOENT is fine (already gone). Anything else is a cleanup nuisance,
    // never a reason to fail the user's upload.
    if (err.code !== 'ENOENT') {
      console.error('Failed to clean up upload temp file:', err.message);
    }
  }
};

/**
 * Upload an image file to Cloudinary.
 * Expects req.file from multer middleware.
 */
const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No image file provided. Please select a file to upload.', 400);
  }

  try {
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
  } finally {
    await cleanupTempFile(req.file && req.file.path);
  }
});

module.exports = { uploadImage };