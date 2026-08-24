import { model, models } from 'mongoose';
import { AuditLogSchema } from './audit-log.schema';

describe('AuditLogSchema append-only', () => {
  const modelName = 'AuditLogAppendOnlySpec';
  const schema = AuditLogSchema.clone();
  schema.set('bufferCommands', false);
  const AuditModel = model(modelName, schema);

  afterAll(() => {
    if (models[modelName]) delete models[modelName];
  });

  it.each([
    ['updateOne', () => AuditModel.updateOne({}, { $set: { action: 'x' } })],
    ['replaceOne', () => AuditModel.replaceOne({}, { action: 'x' })],
    ['deleteMany', () => AuditModel.deleteMany({})],
    [
      'bulkWrite update',
      () =>
        AuditModel.bulkWrite([
          { updateOne: { filter: {}, update: { $set: { action: 'x' } } } },
        ]),
    ],
  ])('rechaza %s', async (_label, operation) => {
    await expect(operation()).rejects.toThrow('append-only');
  });
});
