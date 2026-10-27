const bcrypt = require('bcryptjs');

const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  getEffectivePermissions,
} = require('../constants/permissions');

// Roles that can be created/managed from the dashboard. Owners register themselves.
const ASSIGNABLE_ROLES = ['manager', 'cashier', 'waiter', 'barista', 'staff'];

const sanitizeUser = (user) => ({
  id: user._id,
  cafeId: user.cafeId,
  name: user.name,
  email: user.email,
  role: user.role,
  permissions: getEffectivePermissions(user),
  hasCustomPermissions: Array.isArray(user.permissions) && user.permissions.length > 0,
  pinEnabled: Boolean(user.pinEnabled),
  pinSetAt: user.pinSetAt || null,
  isActive: user.isActive !== false,
  lastLoginAt: user.lastLoginAt || null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const normalizePermissions = (permissions) => {
  if (permissions === undefined) return undefined;
  if (!Array.isArray(permissions)) {
    throw new AppError('permissions must be an array', 400);
  }
  const invalid = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (invalid.length > 0) {
    throw new AppError(`Unknown permission(s): ${invalid.join(', ')}`, 400);
  }
  return [...new Set(permissions)];
};

// 1. List staff users for this cafe
const getStaffUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ cafeId: req.cafeId }).select('-password').sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    users: users.map(sanitizeUser),
  });
});

// 2. Permission catalog + role defaults (drives the admin permission matrix UI)
const getPermissionCatalog = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    permissions: ALL_PERMISSIONS,
    roleDefaults: ROLE_PERMISSIONS,
    roles: ROLES,
    assignableRoles: ASSIGNABLE_ROLES,
  });
});

// 3. Create a new staff user
const createStaffUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, permissions } = req.body;

  if (!name || !email || !password || !role) {
    throw new AppError('name, email, password, and role are required', 400);
  }

  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`, 400);
  }

  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters long', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    throw new AppError('A valid email is required', 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError('A user with this email already exists', 409);
  }

  const normalizedPermissions = normalizePermissions(permissions) || [];

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    cafeId: req.cafeId,
    name: name.trim(),
    email: normalizedEmail,
    password: hashedPassword,
    role,
    permissions: normalizedPermissions,
  });

  res.status(201).json({
    success: true,
    message: 'Staff user created successfully',
    user: sanitizeUser(user),
  });
});

// 4. Update a staff member (profile, role, permissions, active status)
const updateStaffUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await User.findOne({ _id: id, cafeId: req.cafeId });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.role === 'owner' && req.user.role !== 'owner') {
    throw new AppError('Only the owner can modify the owner account', 403);
  }

  const { name, role, permissions, isActive } = req.body;

  if (name !== undefined) user.name = String(name).trim();

  if (role !== undefined) {
    if (user.role === 'owner') {
      throw new AppError('The owner role cannot be changed', 400);
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new AppError(`role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`, 400);
    }
    user.role = role;
  }

  const normalizedPermissions = normalizePermissions(permissions);
  if (normalizedPermissions !== undefined) {
    user.permissions = normalizedPermissions;
  }

  if (isActive !== undefined) {
    if (user.role === 'owner' && isActive === false) {
      throw new AppError('The owner account cannot be deactivated', 400);
    }
    user.isActive = Boolean(isActive);
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Staff user updated',
    user: sanitizeUser(user),
  });
});

// 5. Set / replace a staff member's PIN (Module #08)
const setStaffPin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { pin } = req.body;

  if (!pin || !/^\d{4,6}$/.test(String(pin))) {
    throw new AppError('PIN must be 4 to 6 digits', 400);
  }

  const user = await User.findOne({ _id: id, cafeId: req.cafeId });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const salt = await bcrypt.genSalt(10);
  user.pinHash = await bcrypt.hash(String(pin), salt);
  user.pinEnabled = true;
  user.pinSetAt = new Date();
  user.pinAttempts = 0;
  user.pinLockedUntil = null;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'PIN set successfully',
    user: sanitizeUser(user),
  });
});

// 6. Disable a staff member's PIN
const removeStaffPin = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findOne({ _id: id, cafeId: req.cafeId });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  user.pinHash = null;
  user.pinEnabled = false;
  user.pinSetAt = null;
  user.pinAttempts = 0;
  user.pinLockedUntil = null;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'PIN removed',
    user: sanitizeUser(user),
  });
});

// 7. Delete a staff user
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
  getPermissionCatalog,
  createStaffUser,
  updateStaffUser,
  setStaffPin,
  removeStaffPin,
  deleteStaffUser,
};
