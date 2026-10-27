const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const validateOrderPayload = (req, res, next) => {
  const { tableId, items, notes } = req.body;
  const errors = [];

  if (!tableId) {
    errors.push('Table ID is required');
  } else if (!isValidObjectId(tableId)) {
    errors.push('Invalid Table ID format');
  }

  if (!items || !Array.isArray(items)) {
    errors.push('Order items must be a non-empty array');
  } else if (items.length === 0) {
    errors.push('Order must contain at least one item');
  } else {
    items.forEach((item, index) => {
      if (!item.menuItemId) {
        errors.push(`Item at index ${index} requires a menuItemId`);
      } else if (!isValidObjectId(item.menuItemId)) {
        errors.push(`Item at index ${index} has an invalid menuItemId format`);
      }

      if (item.quantity === undefined || item.quantity === null) {
        errors.push(`Item at index ${index} requires a quantity`);
      } else {
        const qty = Number(item.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          errors.push(`Item at index ${index} quantity must be a positive integer`);
        } else if (qty > 50) {
          errors.push(`Item at index ${index} quantity cannot exceed 50`);
        }
      }
    });
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('Notes must be a string');
  } else if (notes && notes.length > 500) {
    errors.push('Notes cannot exceed 500 characters');
  }

  if (errors.length > 0) {
    return next(new AppError(errors.join('. '), 400));
  }

  next();
};

module.exports = { validateOrderPayload };
