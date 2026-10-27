const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const socketService = require('../services/socketService');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const DEFAULT_LIST_LIMIT = 20;

const resolveLimit = (value, defaultLimit = DEFAULT_LIST_LIMIT) => {
  if (value === undefined) {
    return defaultLimit;
  }

  const parsedLimit = Number(value);

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new AppError('limit must be a positive integer', 400);
  }

  return Math.min(parsedLimit, 100);
};

const resolvePage = (value) => {
  if (value === undefined) {
    return 1;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError('page must be a positive integer', 400);
  }
  return parsed;
};

const validateMenuPayload = ({ categoryId, name, price, isAvailable, gstPercentage }) => {
  const errors = [];

  if (!categoryId || !isValidObjectId(categoryId)) {
    errors.push('Valid categoryId is required');
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Menu item name is required');
  }

  const parsedPrice = Number(price);
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
    errors.push('Price must be a non-negative number');
  }

  if (isAvailable !== undefined && typeof isAvailable !== 'boolean') {
    errors.push('isAvailable must be a boolean value');
  }

  if (gstPercentage !== undefined) {
    const parsedGst = Number(gstPercentage);
    if (!Number.isFinite(parsedGst) || parsedGst < 0 || parsedGst > 100) {
      errors.push('GST percentage must be a number between 0 and 100');
    }
  }

  return errors;
};

const getMenu = asyncHandler(async (req, res) => {
  const { categoryId, isAvailable } = req.query;
  const page = resolvePage(req.query.page);
  const limit = resolveLimit(req.query.limit);
  const skip = (page - 1) * limit;
  const filter = { cafeId: req.cafeId };

  if (categoryId) {
    if (!isValidObjectId(categoryId)) {
      throw new AppError('Invalid categoryId', 400);
    }

    filter.categoryId = categoryId;
  }

  if (isAvailable !== undefined) {
    if (isAvailable !== 'true' && isAvailable !== 'false') {
      throw new AppError('isAvailable must be true or false', 400);
    }

    filter.isAvailable = isAvailable === 'true';
  }

  const [menuItems, totalCount] = await Promise.all([
    MenuItem.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    MenuItem.countDocuments(filter),
  ]);

  res.status(200).json({
    count: menuItems.length,
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    menuItems,
  });
});

const createMenuItem = asyncHandler(async (req, res) => {
  const {
    categoryId,
    name,
    description = '',
    price,
    image = '',
    isAvailable = true,
    gstPercentage = 0,
    variants = [],
    modifierGroups = [],
    dietaryTags = [],
    ingredients = [],
    allergens = [],
    calories = 0,
    prepStation = 'kitchen',
    story = '',
    media = [],
    allergenNote = '',
    spiceLevel = 0,
    prepMinutes = 0,
  } = req.body;
  const errors = validateMenuPayload({ categoryId, name, price, isAvailable, gstPercentage });

  if (errors.length > 0) {
    throw new AppError(errors.join('. '), 400);
  }

  const category = await Category.findOne({ _id: categoryId, cafeId: req.cafeId });
  if (!category) {
    throw new AppError('Category not found for this cafe', 404);
  }

  const normalizedName = name.trim();
  const duplicateMenuItem = await MenuItem.findOne({
    cafeId: req.cafeId,
    categoryId,
    name: normalizedName,
  });

  if (duplicateMenuItem) {
    throw new AppError('Menu item already exists in this category', 409);
  }

  const menuItem = await MenuItem.create({
    cafeId: req.cafeId,
    categoryId,
    name: normalizedName,
    description: description?.trim() || '',
    price: Number(price),
    gstPercentage: Number(gstPercentage),
    image: image?.trim() || '',
    isAvailable,
    variants,
    modifierGroups,
    dietaryTags,
    ingredients,
    allergens,
    calories: Number(calories) || 0,
    prepStation,
    story: String(story || '').slice(0, 1200),
    media: Array.isArray(media) ? media.filter((m) => m && m.url).slice(0, 8) : [],
    allergenNote: String(allergenNote || '').slice(0, 400),
    spiceLevel: Math.min(5, Math.max(0, Number(spiceLevel) || 0)),
    prepMinutes: Math.min(240, Math.max(0, Number(prepMinutes) || 0)),
  });

  res.status(201).json({
    message: 'Menu item created successfully',
    menuItem,
  });
});

const updateMenuItem = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid menu item id', 400);
  }

  const existingMenuItem = await MenuItem.findOne({ _id: id, cafeId: req.cafeId });
  if (!existingMenuItem) {
    throw new AppError('Menu item not found', 404);
  }

  const nextCategoryId = req.body.categoryId || existingMenuItem.categoryId;
  const nextName = req.body.name !== undefined ? req.body.name : existingMenuItem.name;
  const nextPrice = req.body.price !== undefined ? req.body.price : existingMenuItem.price;
  const nextIsAvailable = req.body.isAvailable !== undefined ? req.body.isAvailable : existingMenuItem.isAvailable;
  const nextDescription = req.body.description !== undefined ? req.body.description : existingMenuItem.description;
  const nextImage = req.body.image !== undefined ? req.body.image : existingMenuItem.image;
  const nextGstPercentage = req.body.gstPercentage !== undefined ? req.body.gstPercentage : existingMenuItem.gstPercentage;

  const errors = validateMenuPayload({
    categoryId: nextCategoryId,
    name: nextName,
    price: nextPrice,
    isAvailable: nextIsAvailable,
    gstPercentage: nextGstPercentage,
  });

  if (errors.length > 0) {
    throw new AppError(errors.join('. '), 400);
  }

  const category = await Category.findOne({ _id: nextCategoryId, cafeId: req.cafeId });
  if (!category) {
    throw new AppError('Category not found for this cafe', 404);
  }

  const normalizedName = nextName.trim();
  const duplicateMenuItem = await MenuItem.findOne({
    cafeId: req.cafeId,
    categoryId: nextCategoryId,
    name: normalizedName,
    _id: { $ne: id },
  });

  if (duplicateMenuItem) {
    throw new AppError('Menu item already exists in this category', 409);
  }

  existingMenuItem.categoryId = nextCategoryId;
  existingMenuItem.name = normalizedName;
  existingMenuItem.description = nextDescription?.trim() || '';
  existingMenuItem.price = Number(nextPrice);
  existingMenuItem.gstPercentage = Number(nextGstPercentage);
  existingMenuItem.image = nextImage?.trim() || '';
  existingMenuItem.isAvailable = nextIsAvailable;

  // Module #05/#06 — optional catalog refinements
  const optionalFields = [
    'variants',
    'modifierGroups',
    'dietaryTags',
    'ingredients',
    'allergens',
    'calories',
    'prepStation',
    'story',
    'media',
    'allergenNote',
    'spiceLevel',
    'prepMinutes',
  ];
  const numericFields = ['calories', 'spiceLevel', 'prepMinutes'];
  for (const field of optionalFields) {
    if (req.body[field] !== undefined) {
      if (numericFields.includes(field)) {
        existingMenuItem[field] = Number(req.body[field]) || 0;
      } else if (field === 'media') {
        existingMenuItem.media = Array.isArray(req.body.media)
          ? req.body.media.filter((m) => m && m.url).slice(0, 8)
          : [];
      } else {
        existingMenuItem[field] = req.body[field];
      }
    }
  }

  await existingMenuItem.save();

  res.status(200).json({
    message: 'Menu item updated successfully',
    menuItem: existingMenuItem,
  });
});

const deleteMenuItem = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid menu item id', 400);
  }

  const menuItem = await MenuItem.findOne({ _id: id, cafeId: req.cafeId });

  if (!menuItem) {
    throw new AppError('Menu item not found', 404);
  }

  await MenuItem.deleteOne({ _id: menuItem._id, cafeId: req.cafeId });

  res.status(200).json({
    message: 'Menu item deleted successfully',
  });
});

// 1-tap '86' availability toggle, broadcast to POS + QR menus (Module #05)
const updateMenuItemAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isAvailable } = req.body;

  if (typeof isAvailable !== 'boolean') {
    throw new AppError('isAvailable must be a boolean value', 400);
  }

  const menuItem = await MenuItem.findOne({ _id: id, cafeId: req.cafeId });
  if (!menuItem) {
    throw new AppError('Menu item not found', 404);
  }

  menuItem.isAvailable = isAvailable;
  await menuItem.save();

  socketService.emitMenuAvailability(req.cafeId, {
    menuItemId: menuItem._id,
    isAvailable,
  });

  res.status(200).json({
    success: true,
    message: `Menu item marked ${isAvailable ? 'available' : 'out of stock'}`,
    menuItem,
  });
});

// Public autocomplete search across name / description / ingredients (Module #06)
const searchMenuPublic = asyncHandler(async (req, res) => {
  const { cafeId, q } = req.query;
  if (!cafeId) {
    throw new AppError('cafeId query parameter is required', 400);
  }

  const limit = resolveLimit(req.query.limit);
  const filter = { cafeId, isAvailable: true };

  if (q && String(q).trim()) {
    const regex = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: regex }, { description: regex }, { ingredients: regex }];
  }

  const menuItems = await MenuItem.find(filter).sort({ name: 1 }).limit(limit);

  res.status(200).json({
    count: menuItems.length,
    limit,
    menuItems,
  });
});

const getMenuPublic = asyncHandler(async (req, res) => {
  const { cafeId, categoryId } = req.query;
  if (!cafeId) {
    throw new AppError('cafeId query parameter is required', 400);
  }

  const page = resolvePage(req.query.page);
  const limit = resolveLimit(req.query.limit, 100);
  const skip = (page - 1) * limit;
  const filter = { cafeId, isAvailable: true };

  if (categoryId) {
    if (!isValidObjectId(categoryId)) {
      throw new AppError('Invalid categoryId', 400);
    }
    filter.categoryId = categoryId;
  }

  const [menuItems, totalCount] = await Promise.all([
    MenuItem.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    MenuItem.countDocuments(filter),
  ]);

  res.status(200).json({
    count: menuItems.length,
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    menuItems,
  });
});

module.exports = {
  getMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getMenuPublic,
  updateMenuItemAvailability,
  searchMenuPublic,
};
