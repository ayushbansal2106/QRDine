const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const validateMenuPayload = ({ categoryId, name, price, isAvailable }) => {
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

  return errors;
};

const getMenu = asyncHandler(async (req, res) => {
  const { categoryId, isAvailable } = req.query;
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

  const menuItems = await MenuItem.find(filter).sort({ createdAt: -1 });

  res.status(200).json({
    count: menuItems.length,
    menuItems,
  });
});

const createMenuItem = asyncHandler(async (req, res) => {
  const { categoryId, name, description = '', price, image = '', isAvailable = true } = req.body;
  const errors = validateMenuPayload({ categoryId, name, price, isAvailable });

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

  const errors = validateMenuPayload({
    categoryId: nextCategoryId,
    name: nextName,
    price: nextPrice,
    isAvailable: nextIsAvailable,
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

module.exports = {
  getMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
};
