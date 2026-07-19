const Cafe = require('../models/Cafe');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// 1. Get cafe profile
const getCafe = asyncHandler(async (req, res) => {
  const cafe = await Cafe.findById(req.cafeId);

  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  res.status(200).json({
    success: true,
    cafe,
  });
});

// 2. Update cafe profile
const updateCafe = asyncHandler(async (req, res) => {
  const { name, address, phone, email, logo } = req.body;

  const cafe = await Cafe.findById(req.cafeId);

  if (!cafe) {
    throw new AppError('Cafe not found', 404);
  }

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError('Cafe name is required and must be a non-empty string', 400);
    }
    cafe.name = name.trim();
  }

  if (address !== undefined) {
    cafe.address = address.trim();
  }

  if (phone !== undefined) {
    cafe.phone = phone.trim();
  }

  if (email !== undefined) {
    cafe.email = email.trim().toLowerCase();
  }

  if (logo !== undefined) {
    cafe.logo = logo.trim();
  }

  await cafe.save();

  res.status(200).json({
    success: true,
    message: 'Cafe profile updated successfully',
    cafe,
  });
});

module.exports = {
  getCafe,
  updateCafe,
};
