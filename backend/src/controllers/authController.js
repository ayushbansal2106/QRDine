const bcrypt = require('bcryptjs');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const generateToken = require('../utils/generateToken');
const Cafe = require('../models/Cafe');
const User = require('../models/User');
const { getEffectivePermissions } = require('../constants/permissions');
// Billing. Every new cafe starts on the free trial, created inside the same
// transaction as the cafe itself so a signup can never leave a tenant that
// exists but cannot be billed or gated.
const {
  ensureSubscription,
  getAccessForCafe,
} = require('../services/subscriptionService');

// Module #08 — PIN lockout policy
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

const sanitizeUser = (user) => ({
  id: user._id,
  cafeId: user.cafeId,
  name: user.name,
  email: user.email,
  role: user.role,
  permissions: getEffectivePermissions(user),
  pinEnabled: Boolean(user.pinEnabled),
  isActive: user.isActive !== false,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const resolveLoginEmail = ({ email, ownerEmail }) => email || ownerEmail;

const registerOwner = asyncHandler(async (req, res, next) => {
  const { ownerName, ownerEmail, password, cafe } = req.body;
  const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();
  const normalizedCafeEmail = cafe.email ? cafe.email.trim().toLowerCase() : '';

  const existingUser = await User.findOne({ email: normalizedOwnerEmail });
  if (existingUser) {
    throw new AppError('An account with this email already exists', 409);
  }

  if (normalizedCafeEmail) {
    const existingCafe = await Cafe.findOne({ email: normalizedCafeEmail });
    if (existingCafe) {
      throw new AppError('A cafe with this email already exists', 409);
    }
  }

  const session = await Cafe.startSession();

  try {
    let createdCafe;
    let createdOwner;

    await session.withTransaction(async () => {
      const cafeDocs = await Cafe.create(
        [
          {
            name: cafe.name.trim(),
            logo: cafe.logo?.trim() || '',
            address: cafe.address?.trim() || '',
            phone: cafe.phone?.trim() || '',
            email: normalizedCafeEmail,
          },
        ],
        { session }
      );

      createdCafe = cafeDocs[0];

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const ownerDocs = await User.create(
        [
          {
            cafeId: createdCafe._id,
            name: ownerName.trim(),
            email: normalizedOwnerEmail,
            password: hashedPassword,
            role: 'owner',
          },
        ],
        { session }
      );

      createdOwner = ownerDocs[0];

      await ensureSubscription(createdCafe._id, { session });
    });

    const token = generateToken({
      id: createdOwner._id,
      cafeId: createdOwner.cafeId,
      role: createdOwner.role,
    });

    res.status(201).json({
      message: 'Owner registration successful',
      token,
      user: sanitizeUser(createdOwner),
      cafe: createdCafe,
    });
  } finally {
    session.endSession();
  }
});

const login = asyncHandler(async (req, res) => {
  const { email, ownerEmail, password } = req.body;
  const rawEmail = resolveLoginEmail({ email, ownerEmail });
  if (!rawEmail || typeof rawEmail !== 'string') {
    throw new AppError('Email is required', 400);
  }
  if (!password || typeof password !== 'string') {
    throw new AppError('Password is required', 400);
  }
  const normalizedEmail = rawEmail.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new AppError('Invalid credentials', 401);
  }

  // A terminated tenant is locked out entirely, so a correct password must not
  // mint a new token. Checked *after* the password so the response cannot be
  // used to probe which emails belong to a suspended café.
  const { access } = await getAccessForCafe(user.cafeId);

  if (access.isTerminated) {
    throw new AppError('This account has been suspended. Contact QRDine support.', 410);
  }

  const token = generateToken({
    id: user._id,
    cafeId: user.cafeId,
    role: user.role,
  });

  res.status(200).json({
    message: 'Login successful',
    token,
    user: sanitizeUser(user),
  });
});

const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    user: sanitizeUser(user),
  });
});

/**
 * Module #08 — list the switchable operators for the current tenant.
 * Used by the shared-terminal PIN lock screen; only exposes the minimum
 * needed to render the operator grid (never pinHash or credentials).
 */
const getOperators = asyncHandler(async (req, res) => {
  const operators = await User.find({ cafeId: req.cafeId, isActive: true })
    .select('name role pinEnabled')
    .sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    operators: operators.map((u) => ({
      id: u._id,
      name: u.name,
      role: u.role,
      pinEnabled: Boolean(u.pinEnabled),
    })),
    currentUserId: req.user._id,
  });
});

/**
 * Module #08 — PIN login / operator switch on a shared terminal.
 *
 * The device must already hold a valid admin token (the owner logs in once with
 * email + password); a staff member then assumes their own identity for POS and
 * shift operations by entering their PIN. Returns a fresh JWT scoped to that
 * staff member, so every later request carries the correct role/permissions.
 *
 * Brute-force protection: rate-limited per IP (pinLimiter) AND per-user lockout
 * after PIN_MAX_ATTEMPTS consecutive failures.
 */
const pinLogin = asyncHandler(async (req, res) => {
  const { userId, pin } = req.body;

  if (!userId) {
    throw new AppError('userId is required', 400);
  }
  if (!pin || !/^\d{4,6}$/.test(String(pin))) {
    throw new AppError('PIN must be 4 to 6 digits', 400);
  }

  const user = await User.findOne({ _id: userId, cafeId: req.cafeId }).select('+pinHash');

  if (!user || !user.isActive || !user.pinEnabled || !user.pinHash) {
    throw new AppError('PIN login is not enabled for this operator', 403);
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const mins = Math.ceil((user.pinLockedUntil - Date.now()) / 60000);
    throw new AppError(`PIN locked after too many attempts. Try again in ${mins} minute(s).`, 429);
  }

  const isValid = await bcrypt.compare(String(pin), user.pinHash);

  if (!isValid) {
    user.pinAttempts = (user.pinAttempts || 0) + 1;
    if (user.pinAttempts >= PIN_MAX_ATTEMPTS) {
      user.pinAttempts = 0;
      user.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000);
      await user.save();
      throw new AppError(
        `PIN locked after ${PIN_MAX_ATTEMPTS} failed attempts. Try again in ${PIN_LOCK_MINUTES} minutes.`,
        429
      );
    }
    await user.save();
    throw new AppError('Incorrect PIN', 401);
  }

  user.pinAttempts = 0;
  user.pinLockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  // Same lock-out rule as password login: an operator switch must not be a way
  // back into a suspended account.
  const { access } = await getAccessForCafe(user.cafeId);

  if (access.isTerminated) {
    throw new AppError('This account has been suspended. Contact QRDine support.', 410);
  }

  const token = generateToken({ id: user._id, cafeId: user.cafeId, role: user.role });

  res.status(200).json({
    message: 'PIN login successful',
    token,
    user: sanitizeUser(user),
  });
});

module.exports = { registerOwner, login, getCurrentUser, getOperators, pinLogin };
