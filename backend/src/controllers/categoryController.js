const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const validateCategoryPayload = ({ name, displayOrder }) => {
  const errors = [];

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Category name is required');
  }

  if (displayOrder !== undefined) {
    const parsedDisplayOrder = Number(displayOrder);
    if (!Number.isInteger(parsedDisplayOrder) || parsedDisplayOrder < 0) {
      errors.push('displayOrder must be a non-negative integer');
    }
  }

  return errors;
};

const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ cafeId: req.cafeId }).sort({ displayOrder: 1, createdAt: 1 });

  res.status(200).json({
    count: categories.length,
    categories,
  });
});

const createCategory = asyncHandler(async (req, res) => {
  const { name, displayOrder = 0 } = req.body;
  const errors = validateCategoryPayload({ name, displayOrder });

  if (errors.length > 0) {
    throw new AppError(errors.join('. '), 400);
  }

  const normalizedName = name.trim();
  const duplicateCategory = await Category.findOne({
    cafeId: req.cafeId,
    name: normalizedName,
  });

  if (duplicateCategory) {
    throw new AppError('Category name already exists for this cafe', 409);
  }

  const category = await Category.create({
    cafeId: req.cafeId,
    name: normalizedName,
    displayOrder: Number(displayOrder),
  });

  res.status(201).json({
    message: 'Category created successfully',
    category,
  });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid category id', 400);
  }

  const { name, displayOrder } = req.body;
  const errors = validateCategoryPayload({ name, displayOrder });

  if (errors.length > 0) {
    throw new AppError(errors.join('. '), 400);
  }

  const existingCategory = await Category.findOne({ _id: id, cafeId: req.cafeId });

  if (!existingCategory) {
    throw new AppError('Category not found', 404);
  }

  const normalizedName = name.trim();
  const duplicateCategory = await Category.findOne({
    cafeId: req.cafeId,
    name: normalizedName,
    _id: { $ne: id },
  });

  if (duplicateCategory) {
    throw new AppError('Category name already exists for this cafe', 409);
  }

  existingCategory.name = normalizedName;

  if (displayOrder !== undefined) {
    existingCategory.displayOrder = Number(displayOrder);
  }

  await existingCategory.save();

  res.status(200).json({
    message: 'Category updated successfully',
    category: existingCategory,
  });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new AppError('Invalid category id', 400);
  }

  const category = await Category.findOne({ _id: id, cafeId: req.cafeId });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  const linkedMenuItems = await MenuItem.exists({ cafeId: req.cafeId, categoryId: category._id });

  if (linkedMenuItems) {
    throw new AppError('Cannot delete a category that still has menu items', 409);
  }

  await Category.deleteOne({ _id: category._id, cafeId: req.cafeId });

  res.status(200).json({
    message: 'Category deleted successfully',
  });
});

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
