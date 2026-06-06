const bcrypt = require('bcryptjs');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const generateToken = require('../utils/generateToken');
const Cafe = require('../models/Cafe');
const User = require('../models/User');

const sanitizeUser = (user) => ({
  id: user._id,
  cafeId: user.cafeId,
  name: user.name,
  email: user.email,
  role: user.role,
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
  const normalizedEmail = resolveLoginEmail({ email, ownerEmail }).trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new AppError('Invalid credentials', 401);
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

module.exports = { registerOwner, login, getCurrentUser };
