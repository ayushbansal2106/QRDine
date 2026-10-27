const mongoose = require('mongoose');

const FEATURE_METADATA = {
  pos: { label: 'POS / QR ordering', group: 'counter', domain: 'ops' },
  kds: { label: 'Kitchen display', group: 'counter', domain: 'ops' },
  analytics: { label: 'Sales analytics', group: 'reporting', domain: 'reporting' },
  'reports.export': { label: 'Report export', group: 'reporting', domain: 'reporting' },
  loyalty: { label: 'Loyalty', group: 'marketing', domain: 'marketing' },
  coupons: { label: 'Coupons', group: 'marketing', domain: 'marketing' },
  wallet: { label: 'Customer wallets', group: 'marketing', domain: 'marketing' },
  invoices: { label: 'GST invoices', group: 'billing', domain: 'billing' },
  reviews: { label: 'Reviews & AI', group: 'marketing', domain: 'marketing' },
  nfc: { label: 'NFC tags', group: 'marketing', domain: 'marketing' },
  geofence: { label: 'Fraud watch', group: 'risk', domain: 'risk' },
  digitization: { label: 'Menu digitisation', group: 'operations', domain: 'operations' },
  scratch: { label: 'Scratch cards', group: 'marketing', domain: 'marketing' },
  'support.priority': { label: 'Priority support', group: 'support', domain: 'support' },
};

const KNOWN_FEATURE_KEYS = Object.keys(FEATURE_METADATA);

const BASE_FEATURES = [
  'pos',
  'kds',
  'analytics',
  'reports.export',
  'loyalty',
  'coupons',
  'wallet',
  'invoices',
  'reviews',
  'nfc',
  'geofence',
  'digitization',
  'support.priority',
];

function isBaseFeature(key) {
  return BASE_FEATURES.includes(key);
}

const featureCatalogSchema = new mongoose.Schema(
  {
    /**
     * Platform-wide *grants*: the feature is opened for every plan, whatever
     * the plan catalogue says. This is the rollout control.
     *
     * `Schema.Types.Mixed`, not `Map`: Mongoose's `Map` rejects keys
     * containing a dot, and two registered feature keys have one
     * (`reports.export`, `support.priority`). With `Map` the write failed
     * with a cast error on the first dotted key, so the catalog could only
     * ever be saved for a subset of the registry.
     */
    features: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    /**
     * Platform-wide *blocks*: the feature is closed for every plan, whatever
     * the plan catalogue says. This is the emergency control, and it wins over
     * a plan entitlement — enabling a feature on a plan must never re-open a
     * globally blocked module.
     *
     * Separate from `features` on purpose: the two are different decisions
     * with different consequences, and one map cannot express both.
     */
    blocked: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

featureCatalogSchema.index({ createdAt: 1 });

featureCatalogSchema.virtual('entries').get(function entries() {
  const out = [];
  for (const [key, enabled] of Object.entries(this.features || {})) {
    const meta = FEATURE_METADATA[key];
    if (!meta) continue;
    out.push({
      key,
      label: meta.label,
      group: meta.group,
      enabled: Boolean(enabled),
    });
  }
  return out.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.label.localeCompare(b.label);
  });
});

const model = mongoose.model('FeatureCatalog', featureCatalogSchema);

module.exports = model;
module.exports.BASE_FEATURES = BASE_FEATURES;
module.exports.isBaseFeature = isBaseFeature;
module.exports.knownFeatureKeys = KNOWN_FEATURE_KEYS;
module.exports.FEATURE_METADATA = FEATURE_METADATA;
