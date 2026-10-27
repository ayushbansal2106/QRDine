const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const S = new mongoose.Schema({
  features: { type: mongoose.Schema.Types.Mixed, default: {} },
  limits: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { minimize: false });
const M = mongoose.model('MixedTmp', S);

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

it('assign + save persists dotted keys', async () => {
  const doc = await M.create({ features: { 'reports.export': true }, limits: { 'orders.month': 500 } });
  console.log('created:', JSON.stringify(doc.features), JSON.stringify(doc.limits));
  const again = await M.findById(doc._id);
  again.features = { 'reports.export': false, 'support.priority': true };
  again.limits = { 'orders.month': null };
  await again.save();
  const lean = await M.findById(doc._id).lean();
  console.log('after save:', JSON.stringify(lean.features), JSON.stringify(lean.limits));
  expect(lean.features['reports.export']).toBe(false);
  expect(lean.limits['orders.month']).toBeNull();
});

it('findOneAndUpdate $set persists dotted keys', async () => {
  const doc = await M.create({ features: { pos: true } });
  const upd = await M.findOneAndUpdate(
    { _id: doc._id },
    { $set: { features: { 'reports.export': true, 'orders.month': 1 } } },
    { returnDocument: 'after' }
  );
  console.log('updated:', JSON.stringify(upd.features));
  const lean = await M.findById(doc._id).lean();
  expect(lean.features['reports.export']).toBe(true);
});
