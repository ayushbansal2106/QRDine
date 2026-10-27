const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema(
  {
    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cafe',
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    gstPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // Module #05 — price variants / sizes (Regular, Large, Iced)
    variants: [
      {
        name: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
        isDefault: { type: Boolean, default: false },
      },
    ],
    // Module #05 — modifier groups and their priced options
    modifierGroups: [
      {
        name: { type: String, required: true, trim: true },
        selectionType: { type: String, enum: ['single', 'multi'], default: 'single' },
        isRequired: { type: Boolean, default: false },
        min: { type: Number, default: 0 },
        max: { type: Number, default: 1 },
        options: [
          {
            name: { type: String, required: true, trim: true },
            price: { type: Number, default: 0 },
            isDefault: { type: Boolean, default: false },
          },
        ],
      },
    ],
    // Module #06 — visual catalog metadata
    dietaryTags: {
      type: [String],
      default: [],
    },
    ingredients: {
      type: [String],
      default: [],
    },
    allergens: {
      type: [String],
      default: [],
    },
    calories: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Module #06 — customer-facing showcase content
    // Short narrative shown on the dish detail sheet ("why we make it this way").
    story: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1200,
    },
    // Additional photos, shown as a gallery on the customer menu.
    //
    // `url` was `required: true`, but AI digitisation links a dish to a bundled
    // library photo by key instead of a URL. Every such item then failed
    // validation with "url is required" and publishing died with a 500 — one
    // photo match anywhere in the draft was enough to break the whole publish.
    //
    // A media entry now needs *either* a url *or* a dishKey; an entry with
    // neither is still rejected. Consumers read `m.url` and filter falsy
    // values, so a key-only entry is simply not rendered as an image until the
    // library carries real URLs.
    media: {
      type: [
        {
          url: { type: String, trim: true, default: '' },
          caption: { type: String, trim: true, default: '', maxlength: 160 },
          dishKey: { type: String, trim: true, default: '' },
          source: {
            type: String,
            enum: ['upload', 'dish_library'],
            default: 'upload',
          },
        },
      ],
      default: [],
      validate: {
        validator: (entries) =>
          Array.isArray(entries) &&
          entries.every((e) => Boolean(e.url && e.url.trim()) || Boolean(e.dishKey && e.dishKey.trim())),
        message: 'Each media entry needs a url or a dishKey',
      },
    },
    // Plain-language allergen note, written for customers rather than lawyers.
    allergenNote: {
      type: String,
      trim: true,
      default: '',
      maxlength: 400,
    },
    spiceLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    prepMinutes: {
      type: Number,
      default: 0,
      min: 0,
      max: 240,
    },
    // Module #07 — KDS station routing
    prepStation: {
      type: String,
      enum: ['kitchen', 'bar', 'both'],
      default: 'kitchen',
    },
  },
  {
    timestamps: true,
  }
);

menuItemSchema.index({ cafeId: 1 });
menuItemSchema.index({ cafeId: 1, categoryId: 1 });
menuItemSchema.index({ cafeId: 1, categoryId: 1, name: 1 }, { unique: true });
menuItemSchema.index({ cafeId: 1, isAvailable: 1 });
menuItemSchema.index({ cafeId: 1, createdAt: -1 });
menuItemSchema.index({ cafeId: 1, categoryId: 1, createdAt: -1 });
menuItemSchema.index({ cafeId: 1, name: 'text', description: 'text' });
menuItemSchema.index({ cafeId: 1, prepStation: 1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
