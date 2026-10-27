/**
 * Module #16 — Scratch card service tests
 * Tests: drawPrize (weighted), maybeIssueCard (limits), revealCard (prize + voucher)
 */

const mockCampaignFindOne = jest.fn();
const mockCampaignFindOneAndUpdate = jest.fn();
const mockCardCreate = jest.fn();
const mockCardFindOne = jest.fn();
const mockCardCountDocuments = jest.fn();
const mockIssueVoucher = jest.fn();
const mockAuditRecord = jest.fn();
const mockEmitIssued = jest.fn();
const mockEmitRevealed = jest.fn();

jest.mock('../src/models/ScratchCampaign', () => ({
  findOne: (...a) => mockCampaignFindOne(...a),
  findOneAndUpdate: (...a) => mockCampaignFindOneAndUpdate(...a),
}));

jest.mock('../src/models/ScratchCard', () => ({
  create: (...a) => mockCardCreate(...a),
  findOne: (...a) => mockCardFindOne(...a),
  countDocuments: (...a) => mockCardCountDocuments(...a),
}));

jest.mock('../src/services/loyaltyService', () => ({
  issueVoucher: (...a) => mockIssueVoucher(...a),
}));

jest.mock('../src/services/auditService', () => ({ recordEvent: (...a) => mockAuditRecord(...a) }));
jest.mock('../src/services/socketService', () => ({
  emitScratchIssued: (...a) => mockEmitIssued(...a),
  emitScratchRevealed: (...a) => mockEmitRevealed(...a),
}));

const scratchService = require('../src/services/scratchService');

afterEach(() => {
  jest.clearAllMocks();
  mockAuditRecord.mockResolvedValue(true);
});

const makeCampaign = (overrides = {}) => ({
  _id: 'camp-1',
  cafeId: 'cafe-1',
  isActive: true,
  prizes: [
    { label: 'Better luck next time', type: 'none', value: 0, weight: 70, stock: 0, claimed: 0 },
    { label: '₹50 off', type: 'flat_off', value: 50, weight: 20, stock: 0, claimed: 0 },
    { label: 'Free coffee', type: 'free_item', value: 0, weight: 10, stock: 5, claimed: 0 },
  ],
  eligibleMinSpend: 100,
  maxCardsPerDay: 0,
  maxCardsPerCustomer: 0,
  voucherValidDays: 15,
  startAt: null,
  endAt: null,
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

describe('scratchService.drawPrize (#16)', () => {
  it('selects the "no win" prize for low rolls', () => {
    const campaign = makeCampaign();
    const drawn = scratchService.drawPrize(campaign, () => 0.01);
    expect(drawn.prize.label).toBe('Better luck next time');
  });

  it('selects a mid-pool prize for a mid roll', () => {
    const campaign = makeCampaign();
    // total weight 100; roll 75 -> lands on the ₹50 prize (70..90)
    const drawn = scratchService.drawPrize(campaign, () => 0.75);
    expect(drawn.prize.label).toBe('₹50 off');
  });

  it('ignores prizes whose finite stock is exhausted', () => {
    const campaign = makeCampaign();
    campaign.prizes[2].claimed = 5; // free coffee stock used up
    const drawn = scratchService.drawPrize(campaign, () => 0.999);
    expect(drawn.prize.type).not.toBe('free_item');
  });

  it('returns null when no prize is available', () => {
    const campaign = makeCampaign({ prizes: [] });
    expect(scratchService.drawPrize(campaign, () => 0.5)).toBeNull();
  });
});

describe('scratchService.maybeIssueCard (#16)', () => {
  it('issues a card when the campaign is live and min spend is met', async () => {
    mockCampaignFindOne.mockResolvedValue(makeCampaign());
    mockCardCountDocuments.mockResolvedValue(0);
    mockCardCreate.mockResolvedValue({ _id: 'card-1', status: 'issued' });

    const card = await scratchService.maybeIssueCard({
      cafeId: 'cafe-1',
      customerId: 'cust-1',
      orderId: 'order-1',
      amount: 250,
    });

    expect(card._id).toBe('card-1');
    expect(mockEmitIssued).toHaveBeenCalled();
  });

  it('does not issue when the campaign is inactive', async () => {
    mockCampaignFindOne.mockResolvedValue(makeCampaign({ isActive: false }));

    const card = await scratchService.maybeIssueCard({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 250 });

    expect(card).toBeNull();
    expect(mockCardCreate).not.toHaveBeenCalled();
  });

  it('does not issue below the minimum spend', async () => {
    mockCampaignFindOne.mockResolvedValue(makeCampaign());

    const card = await scratchService.maybeIssueCard({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 50 });

    expect(card).toBeNull();
  });

  it('does not issue when the per-customer cap is reached', async () => {
    mockCampaignFindOne.mockResolvedValue(makeCampaign({ maxCardsPerCustomer: 2 }));
    mockCardCountDocuments.mockResolvedValue(2);

    const card = await scratchService.maybeIssueCard({ cafeId: 'cafe-1', customerId: 'cust-1', amount: 250 });

    expect(card).toBeNull();
  });
});

describe('scratchService.revealCard (#16)', () => {
  const makeCard = (overrides = {}) => ({
    _id: 'card-1',
    cafeId: 'cafe-1',
    customerId: 'cust-1',
    status: 'issued',
    prize: {},
    voucherCode: null,
    revealedAt: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  it('reveals a winning prize and issues a reward voucher', async () => {
    const card = makeCard();
    const campaign = makeCampaign();
    mockCardFindOne.mockResolvedValue(card);
    mockCampaignFindOne.mockResolvedValue(campaign);
    mockIssueVoucher.mockResolvedValue({ code: 'RWD-XYZ', label: '₹50 off', type: 'flat_off', value: 50 });

    // Force a winning draw by stubbing Math.random to land on the ₹50 prize
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.75);
    const result = await scratchService.revealCard({ cafeId: 'cafe-1', cardId: 'card-1', customerId: 'cust-1' });
    spy.mockRestore();

    expect(card.status).toBe('revealed');
    expect(card.voucherCode).toBe('RWD-XYZ');
    expect(result.voucher.code).toBe('RWD-XYZ');
    expect(mockEmitRevealed).toHaveBeenCalled();
  });

  it('reveals a losing draw without issuing a voucher', async () => {
    const card = makeCard();
    mockCardFindOne.mockResolvedValue(card);
    mockCampaignFindOne.mockResolvedValue(makeCampaign());

    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = await scratchService.revealCard({ cafeId: 'cafe-1', cardId: 'card-1', customerId: 'cust-1' });
    spy.mockRestore();

    expect(result.voucher).toBeNull();
    expect(card.prize.type).toBe('none');
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it('rejects a card that has already been revealed', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ status: 'revealed' }));

    await expect(
      scratchService.revealCard({ cafeId: 'cafe-1', cardId: 'card-1', customerId: 'cust-1' })
    ).rejects.toThrow(/already been revealed/i);
  });

  it('rejects revealing another customer\'s card', async () => {
    mockCardFindOne.mockResolvedValue(makeCard({ customerId: 'other-customer' }));

    await expect(
      scratchService.revealCard({ cafeId: 'cafe-1', cardId: 'card-1', customerId: 'cust-1' })
    ).rejects.toThrow(/does not belong/i);
  });
});
