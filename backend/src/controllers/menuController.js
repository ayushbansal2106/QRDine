const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const DEFAULT_LIST_LIMIT = 20;

const resolveLimit = (value) => {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }

  const parsedLimit = Number(value);

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new AppError('limit must be a positive integer', 400);
  }

  return parsedLimit;
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
  const limit = resolveLimit(req.query.limit);
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

  const menuItems = await MenuItem.find(filter).sort({ createdAt: -1 }).limit(limit);

  res.status(200).json({
    count: menuItems.length,
    limit,
    menuItems,
  });
});

const createMenuItem = asyncHandler(async (req, res) => {
  const { categoryId, name, description = '', price, image = '', isAvailable = true, gstPercentage = 0 } = req.body;
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

const getMenuPublic = asyncHandler(async (req, res) => {
  const { cafeId, categoryId } = req.query;
  if (!cafeId) {
    throw new AppError('cafeId query parameter is required', 400);
  }

  const limit = resolveLimit(req.query.limit);
  const filter = { cafeId, isAvailable: true };

  if (categoryId) {
    if (!isValidObjectId(categoryId)) {
      throw new AppError('Invalid categoryId', 400);
    }
    filter.categoryId = categoryId;
  }

  const menuItems = await MenuItem.find(filter).sort({ createdAt: -1 }).limit(limit);

  res.status(200).json({
    count: menuItems.length,
    limit,
    menuItems,
  });
});

module.exports = {
  getMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getMenuPublic,
};
