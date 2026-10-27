const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const {
  publicCatalogue,
  quote,
  isPlanKey,
  isCycle,
  FREE_TRIAL_DAYS,
  GRACE_DAYS,
  GST_RATE,
} = require('../config/plans');
const subscriptionService = require('../services/subscriptionService');
const entitlementService = require('../services/entitlementService');

/**
 * Public pricing catalogue. No auth: this feeds the marketing/pricing page, and
 * nothing here is tenant-specific.
 */
const getPlans = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    currency: 'INR',
    gstRate: GST_RATE,
    freeTrialDays: FREE_TRIAL_DAYS,
    graceDays: GRACE_DAYS,
    plans: publicCatalogue(),
  });
});

/**
 * The tenant's own plan and what it may do right now.
 *
 * `access` is recomputed per request rather than read off the row, so the
 * admin UI never shows a status that the enforcement middleware disagrees with.
 */
const getMySubscription = asyncHandler(async (req, res) => {
  const { subscription, access } = await subscriptionService.getAccessForCafe(req.cafeId);

  res.status(200).json({
    success: true,
    subscription: subscriptionService.publicSubscription(subscription, access),
  });
});

/**
 * The tenant's authoritative entitlements, with live usage.
 *
 * This is what the admin UI renders from. It is a *read* of the same resolution
 * the enforcement middleware uses, so the paywall a cafe sees and the 403 it
 * receives can never disagree. Nothing here is oracles-from-the-client: the
 * cafeId comes from the verified token via `tenantMiddleware`, never from the
 * query string.
 */
const getEntitlements = asyncHandler(async (req, res) => {
  const entitlements = await entitlementService.getEntitlementsForCafe(req.cafeId);
  const usage = await entitlementService.getUsageOverview(req.cafeId);

  res.status(200).json({
    success: true,
    entitlements: {
      planKey: entitlements.planKey,
      planName: entitlements.planName,
      planVersion: entitlements.planVersion,
      planVersionIsCurrent: entitlements.planVersionIsCurrent,
      status: entitlements.status,
      isTerminated: entitlements.isTerminated,
      isDegraded: entitlements.isDegraded,
      isCancelled: entitlements.isCancelled,
      inGrace: entitlements.inGrace,
      isPayable: entitlements.isPayable,
      paidUntil: entitlements.paidUntil,
      features: entitlements.features,
      blockedFeatures: entitlements.blockedFeatures,
    },
    usage,
  });
});

const getQuote = asyncHandler(async (req, res) => {
  const { planKey, cycle = 'monthly', outlets = 1 } = req.body || {};

  if (!isPlanKey(planKey)) throw new AppError('Unknown plan', 400);
  if (!isCycle(cycle)) throw new AppError('Billing cycle must be monthly or annual', 400);

  const requested = Number(outlets);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new AppError('outlets must be a positive whole number', 400);
  }

  res.status(200).json({ success: true, quote: quote({ planKey, cycle, outlets: requested }) });
});

/**
 * Checkout is intentionally not implemented.
 *
 * Payment collection is the one piece of this that needs a real gateway and
 * real webhook signature verification. Shipping a stub that pretends to charge
 * would be worse than refusing: a café would believe it had paid, and we would
 * have no record of the money. Until RAZORPAY_* is configured this says so
 * plainly instead of inventing a flow.
 */
const startCheckout = asyncHandler(async (req, res) => {
  const { planKey, cycle = 'monthly', outlets = 1 } = req.body || {};

  if (!isPlanKey(planKey)) throw new AppError('Unknown plan', 400);
  if (!isCycle(cycle)) throw new AppError('Billing cycle must be monthly or annual', 400);

  const priced = quote({ planKey, cycle, outlets });

  res.status(503).json({
    success: false,
    code: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
    message:
      'Your plan change request has been noted and sent to our team. We will get back to you within 24-48 working hours.',
    quote: priced,
  });
});

const cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.scheduleCancellation(req.cafeId, {
    atPeriodEnd: true,
  });
  const access = subscriptionService.computeAccess(subscription);

  res.status(200).json({
    success: true,
    message: `Your plan stays active until ${subscription.currentPeriodEnd
      ? subscription.currentPeriodEnd.toISOString()
      : 'the end of the current period'}.`,
    subscription: subscriptionService.publicSubscription(subscription, access),
  });
});

const resumeSubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.resumeSubscription(req.cafeId);
  const access = subscriptionService.computeAccess(subscription);

  res.status(200).json({
    success: true,
    message: 'Your subscription will renew as normal.',
    subscription: subscriptionService.publicSubscription(subscription, access),
  });
});

const subscriptionInvoiceService = require('../services/subscriptionInvoiceService');

/**
 * Stage 5 / Task 5.2 — Retrieve B2B subscription GST invoices for this tenant.
 */
const getMyInvoices = asyncHandler(async (req, res) => {
  const invoices = await subscriptionInvoiceService.getInvoicesForCafe(req.cafeId);
  res.status(200).json({
    success: true,
    count: invoices.length,
    invoices,
  });
});

/**
 * Stage 5 / Task 5.2 — Download statutory Rule 46 GST tax invoice PDF.
 */
const getInvoicePdf = asyncHandler(async (req, res) => {
  const invoice = await subscriptionInvoiceService.getInvoiceById(req.params.id, req.cafeId);
  if (!invoice) throw new AppError('Invoice not found or access denied', 404);

  const pdfBuffer = await subscriptionInvoiceService.generateSubscriptionInvoicePdf(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  res.send(pdfBuffer);
});

module.exports = {
  getPlans,
  getMySubscription,
  getEntitlements,
  getQuote,
  startCheckout,
  cancelSubscription,
  resumeSubscription,
  getMyInvoices,
  getInvoicePdf,
};