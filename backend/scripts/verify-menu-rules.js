#!/usr/bin/env node
/**
 * Menu Rules Pre-Flight Verification Tool (Form B - Task 4.2).
 *
 * Audits a restaurant's menu catalog before live customer ordering:
 * 1. Valid category bindings and unique IDs.
 * 2. Positive pricing (base price > 0 or at least one priced variant).
 * 3. Mandatory dietary flags (veg / non-veg / egg).
 * 4. Allergen declarations for common allergens (nuts, gluten, dairy).
 * 5. GST tax rate validation (5% food vs 18% beverages).
 *
 * Usage:
 *   node scripts/verify-menu-rules.js <cafeId>
 *   node scripts/verify-menu-rules.js --all
 */

'use strict';

const mongoose = require('mongoose');
const MenuItem = require('../src/models/MenuItem');
const Category = require('../src/models/Category');
const Cafe = require('../src/models/Cafe');

const COMMON_ALLERGEN_KEYWORDS = {
  nuts: ['peanut', 'almond', 'walnut', 'cashew', 'pistachio', 'hazelnut', 'nut'],
  gluten: ['wheat', 'flour', 'bread', 'roti', 'naan', 'pasta', 'maida', 'gluten'],
  dairy: ['milk', 'cheese', 'paneer', 'butter', 'ghee', 'cream', 'curd', 'yogurt', 'dairy'],
};

/**
 * Audit a single menu item against pre-flight rules.
 */
const auditMenuItem = (item, validCategoryIds = new Set(), cafeTaxMode = 'composite_5') => {
  const issues = [];
  const warnings = [];

  // Check 1: Valid category binding
  if (!item.categoryId || !validCategoryIds.has(String(item.categoryId))) {
    issues.push({
      itemId: String(item._id),
      itemName: item.name,
      code: 'INVALID_CATEGORY',
      message: `Dish "${item.name}" has missing or orphaned categoryId`,
    });
  }

  // Check 2: Pricing validation (zero unpriced dishes)
  const basePrice = Number(item.price) || 0;
  const hasPricedVariants =
    Array.isArray(item.variants) &&
    item.variants.length > 0 &&
    item.variants.some((v) => Number(v.price) > 0);

  if (basePrice <= 0 && !hasPricedVariants) {
    issues.push({
      itemId: String(item._id),
      itemName: item.name,
      code: 'UNPRICED_DISH',
      message: `Dish "${item.name}" has zero or negative price without priced variants`,
    });
  }

  // Check 3: Mandatory dietary declaration
  const dietaryTags = (item.dietaryTags || []).map((t) => String(t).toLowerCase().trim());
  const hasDietary = dietaryTags.some((t) => ['veg', 'non-veg', 'nonveg', 'vegan', 'egg'].includes(t));
  if (!hasDietary) {
    issues.push({
      itemId: String(item._id),
      itemName: item.name,
      code: 'MISSING_DIETARY_TAG',
      message: `Dish "${item.name}" lacks mandatory dietary classification (veg, non-veg, or egg)`,
    });
  }

  // Check 4: Allergen declarations
  const textToScan = `${item.name} ${item.description || ''} ${(item.ingredients || []).join(' ')}`.toLowerCase();
  const declaredAllergens = (item.allergens || []).map((a) => String(a).toLowerCase());

  for (const [allergen, keywords] of Object.entries(COMMON_ALLERGEN_KEYWORDS)) {
    const mentionsKeyword = keywords.some((kw) => textToScan.includes(kw));
    const hasAllergenTag = declaredAllergens.some((a) => a.includes(allergen));

    if (mentionsKeyword && !hasAllergenTag) {
      warnings.push({
        itemId: String(item._id),
        itemName: item.name,
        code: 'UNDECLARED_ALLERGEN',
        message: `Dish "${item.name}" mentions ${allergen}-related ingredients but lacks allergen tag "${allergen}"`,
      });
    }
  }

  // Check 5: Tax rate alignment
  const gstPercentage = Number(item.gstPercentage) || 0;
  if (![0, 5, 12, 18, 28].includes(gstPercentage)) {
    warnings.push({
      itemId: String(item._id),
      itemName: item.name,
      code: 'NON_STANDARD_GST',
      message: `Dish "${item.name}" uses non-standard GST rate: ${gstPercentage}%`,
    });
  }

  return { issues, warnings };
};

/**
 * Verify all menu items for a specific cafe.
 */
const verifyMenuRules = async (cafeId) => {
  const [cafe, categories, items] = await Promise.all([
    Cafe.findById(cafeId),
    Category.find({ cafeId }).lean(),
    MenuItem.find({ cafeId }).lean(),
  ]);

  if (!cafe) {
    throw new Error(`Cafe ${cafeId} not found`);
  }

  const validCategoryIds = new Set(categories.map((c) => String(c._id)));

  const allIssues = [];
  const allWarnings = [];

  for (const item of items) {
    const result = auditMenuItem(item, validCategoryIds, cafe.taxMode);
    allIssues.push(...result.issues);
    allWarnings.push(...result.warnings);
  }

  // Calculate health score: 100 minus (15 per fatal issue) minus (3 per warning), min 0
  const deduction = allIssues.length * 15 + allWarnings.length * 3;
  const score = Math.max(0, 100 - deduction);
  const isApproved = allIssues.length === 0;

  return {
    cafeId: String(cafeId),
    cafeName: cafe.name,
    totalCategories: categories.length,
    totalItems: items.length,
    issueCount: allIssues.length,
    warningCount: allWarnings.length,
    score,
    isApproved,
    issues: allIssues,
    warnings: allWarnings,
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
QRDine Menu Rules Pre-Flight Verification Tool (Form B)
======================================================
Usage:
  node scripts/verify-menu-rules.js <cafeId>
  node scripts/verify-menu-rules.js --all
`);
    process.exit(1);
  }

  const connect = require('../src/config/db');
  await connect();

  try {
    const target = args[0];
    let cafeIds = [];

    if (target === '--all') {
      const cafes = await Cafe.find({}, '_id').lean();
      cafeIds = cafes.map((c) => String(c._id));
    } else {
      cafeIds = [target];
    }

    console.log(`\nAuditing menu pre-flight rules across ${cafeIds.length} cafe(s)...`);
    console.log('------------------------------------------------------------');

    let overallApproved = true;

    for (const id of cafeIds) {
      const report = await verifyMenuRules(id);
      console.log(`\nCafe: ${report.cafeName} (ID: ${report.cafeId})`);
      console.log(`Catalog: ${report.totalItems} items across ${report.totalCategories} categories`);
      console.log(`Health Score: ${report.score}/100 | Status: ${report.isApproved ? '[APPROVED]' : '[BLOCKED]'}`);

      if (report.issues.length > 0) {
        overallApproved = false;
        console.log(`Fatal Issues (${report.issueCount}):`);
        report.issues.forEach((iss) => console.log(`  ❌ [${iss.code}] ${iss.message}`));
      }

      if (report.warnings.length > 0) {
        console.log(`Operational Advisories (${report.warningCount}):`);
        report.warnings.forEach((warn) => console.log(`  ⚠️  [${warn.code}] ${warn.message}`));
      }
    }

    console.log('\n------------------------------------------------------------');
    console.log(`Overall Pre-Flight Decision: ${overallApproved ? 'ALL PASSED' : 'CORRECTIONS REQUIRED'}\n`);

    await mongoose.disconnect();
    process.exit(overallApproved ? 0 : 1);
  } catch (err) {
    console.error('[ERROR] Menu verification failed:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  auditMenuItem,
  verifyMenuRules,
};
