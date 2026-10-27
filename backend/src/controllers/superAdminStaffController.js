const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const SuperAdmin = require('../models/SuperAdmin');
const { SUPER_ADMIN_ROLES } = SuperAdmin;

/**
 * Platform staff management — the panel equivalent of
 * `scripts/create-superadmin.js`.
 *
 * Previously the only way to onboard a colleague was shell access and the
 * script, which meant the control plane could not be operated by a team. These
 * handlers expose the same operation safely.
 *
 * ── Safety rails (each one prevents a real lock-out) ─────────────────────
 *   - You cannot demote or deactivate *your own* account. The most likely
 *     mistake on this page is an operator removing their own access and being
 *     unable to undo it.
 *   - The last active `superadmin` cannot be demoted or deactivated. Roles are
 *     authorisation for this page itself, so zero superadmins means the panel
 *     becomes unreachable and only the script can recover it — the exact
 *     dependency this feature exists to remove.
 *   - Deactivation is *immediate*: `protectSuperAdmin` re-reads `isActive` on
 *     every request, so an open session dies on its next call. There is no need
 *     for a blocklist, and no token to hunt down.
 *   - Passwords are never returned, and a hash is never accepted from a client.
 */

const MIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeStaff = (admin) => ({
  id: admin._id,
  email: admin.email,
  name: admin.name || '',
  role: admin.role,
  isActive: admin.isActive !== false,
  lastLoginAt: admin.lastLoginAt || null,
  lockedUntil: admin.lockedUntil || null,
  failedAttempts: admin.failedAttempts || 0,
  createdAt: admin.createdAt,
  updatedAt: admin.updatedAt,
});

/** How many operators can currently reach this control plane. */
const countActiveSuperadmins = () =>
  SuperAdmin.countDocuments({
    role: SUPER_ADMIN_ROLES.SUPERADMIN,
    isActive: true,
  });

const isSelf = (req, target) =>
  String(req.superAdmin._id) === String(target._id);

/**
 * Would this change leave the platform with nobody who can administer it?
 *
 * Only counts the transition *away* from being an active superadmin, and only
 * when this account is the last one. Everything else is a normal edit.
 */
const wouldStrandPlatform = async (target, nextRole, nextIsActive) => {
  const currentlyCounts =
    target.role === SUPER_ADMIN_ROLES.SUPERADMIN && target.isActive !== false;
  if (!currentlyCounts) return false;

  const stillCounts =
    nextRole === SUPER_ADMIN_ROLES.SUPERADMIN && nextIsActive !== false;
  if (stillCounts) return false;

  return (await countActiveSuperadmins()) <= 1;
};

// ─── Read ────────────────────────────────────────────────────────────────

const listStaff = asyncHandler(async (req, res) => {
  const staff = await SuperAdmin.find({})
    .select('-password')
    .sort({ createdAt: 1 })
    .lean();

  res.status(200).json({
    success: true,
    count: staff.length,
    roles: Object.values(SUPER_ADMIN_ROLES),
    currentUserId: String(req.superAdmin._id),
    staff: staff.map(sanitizeStaff),
  });
});

// ─── Create ──────────────────────────────────────────────────────────────

const createStaff = asyncHandler(async (req, res) => {
  const { email, name, role, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new AppError('A valid email address is required', 400);
  }
  if (!Object.values(SUPER_ADMIN_ROLES).includes(role)) {
    throw new AppError(
      `Unknown role. Choose one of: ${Object.values(SUPER_ADMIN_ROLES).join(', ')}`,
      400
    );
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. This credential can terminate every customer; a short one is not acceptable.`,
      400
    );
  }

  const existing = await SuperAdmin.findOne({ email: normalizedEmail });
  if (existing) {
    throw new AppError('A staff account with this email already exists', 409);
  }

  const hash = await SuperAdmin.hashPassword(password);

  const created = await SuperAdmin.create({
    email: normalizedEmail,
    name: String(name || '').trim(),
    password: hash,
    role,
    isActive: true,
    passwordChangedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    message: `Created ${created.email} (${created.role}).`,
    staff: sanitizeStaff(created),
  });
});

// ─── Update ──────────────────────────────────────────────────────────────

const updateStaff = asyncHandler(async (req, res) => {
  const { staffId } = req.params;
  const { name, role, isActive } = req.body || {};

  const target = await SuperAdmin.findById(staffId);
  if (!target) throw new AppError('Staff account not found', 404);

  const nextRole = role === undefined ? target.role : role;
  const nextIsActive = isActive === undefined ? target.isActive !== false : Boolean(isActive);

  if (role !== undefined && !Object.values(SUPER_ADMIN_ROLES).includes(nextRole)) {
    throw new AppError(
      `Unknown role. Choose one of: ${Object.values(SUPER_ADMIN_ROLES).join(', ')}`,
      400
    );
  }

  if (isSelf(req, target) && (nextRole !== SUPER_ADMIN_ROLES.SUPERADMIN || nextIsActive === false)) {
    throw new AppError(
      'You cannot demote or deactivate your own account, because you would lose access to this page.',
      400
    );
  }

  if (await wouldStrandPlatform(target, nextRole, nextIsActive)) {
    throw new AppError(
      'This is the last active superadmin. Promote another account first, or the control plane would become unreachable.',
      400
    );
  }

  if (name !== undefined) target.name = String(name).trim();
  target.role = nextRole;
  target.isActive = nextIsActive;

  await target.save();

  res.status(200).json({
    success: true,
    message: nextIsActive
      ? `Updated ${target.email}.`
      : `Deactivated ${target.email}. Their open sessions stop working on the next request.`,
    staff: sanitizeStaff(target),
  });
});

// ─── Password reset ──────────────────────────────────────────────────────

const resetStaffPassword = asyncHandler(async (req, res) => {
  const { staffId } = req.params;
  const { password } = req.body || {};

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      400
    );
  }

  const target = await SuperAdmin.findById(staffId);
  if (!target) throw new AppError('Staff account not found', 404);

  target.password = await SuperAdmin.hashPassword(password);
  target.passwordChangedAt = new Date();
  // A reset is also the cure for a lockout, so clear the brute-force counters.
  target.failedAttempts = 0;
  target.lockedUntil = null;
  await target.save();

  res.status(200).json({
    success: true,
    message: `Password reset for ${target.email}.`,
    staff: sanitizeStaff(target),
  });
});

/** Clear a brute-force lockout without forcing a new password. */
const unlockStaff = asyncHandler(async (req, res) => {
  const { staffId } = req.params;

  const target = await SuperAdmin.findById(staffId);
  if (!target) throw new AppError('Staff account not found', 404);

  target.failedAttempts = 0;
  target.lockedUntil = null;
  await target.save();

  res.status(200).json({
    success: true,
    message: `${target.email} unlocked.`,
    staff: sanitizeStaff(target),
  });
});

module.exports = {
  listStaff,
  createStaff,
  updateStaff,
  resetStaffPassword,
  unlockStaff,
  MIN_PASSWORD_LENGTH,
};
