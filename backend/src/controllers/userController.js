const bcrypt = require('bcryptjs');

const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const sanitizeUser = (user) => ({
  id: user._id,
  cafeId: user.cafeId,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// 1. List staff users for this cafe
const getStaffUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ cafeId: req.cafeId }).select('-password').sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    users: users.map(sanitizeUser),
  });
});

// 2. Create a new staff user (manager or staff role)
const createStaffUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    throw new AppError('name, email, password, and role are required', 400);
  }

  if (!['manager', 'staff'].includes(role)) {
    throw new AppError('role must be "manager" or "staff"', 400);
  }

  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters long', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    throw new AppError('A valid email is required', 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check for existing user with this email
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError('A user with this email already exists', 409);
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    cafeId: req.cafeId,
    name: name.trim(),
    email: normalizedEmail,
    password: hashedPassword,
    role,
  });

  res.status(201).json({
    success: true,
    message: 'Staff user created successfully',
    user: sanitizeUser(user),
  });
});

// 3. Delete a staff user
const deleteStaffUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findOne({ _id: id, cafeId: req.cafeId });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.role === 'owner') {
    throw new AppError('Cannot delete the cafe owner', 403);
  }

  await User.deleteOne({ _id: user._id, cafeId: req.cafeId });

  res.status(200).json({
    success: true,
    message: 'Staff user deleted successfully',
  });
});

module.exports = {
  getStaffUsers,
  createStaffUser,
  deleteStaffUser,
};
