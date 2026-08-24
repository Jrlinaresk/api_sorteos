import { Types } from 'mongoose';
import { TransactionalEmailStatus } from './schema/transactional-email.schema';
import { TransactionalEmailService } from './transactional-email.service';

function queryResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('TransactionalEmailService', () => {
  const input = {
    eventKey: 'fulfillment:payment-1:paid',
    recipient: 'buyer@example.com',
    subject: 'Pago confirmado',
    body: 'Tus títulos están disponibles.',
  };
  let model: {
    findOne: jest.Mock;
    create: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let email: { sendTransactionalEmail: jest.Mock };
  let service: TransactionalEmailService;

  beforeEach(() => {
    model = {
      findOne: jest.fn(),
      create: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
    };
    email = { sendTransactionalEmail: jest.fn().mockResolvedValue(undefined) };
    service = new TransactionalEmailService(model as never, email as never);
  });

  it('persiste, toma lease y marca enviado antes de confirmar el efecto', async () => {
    const record = {
      _id: new Types.ObjectId(),
      ...input,
      status: TransactionalEmailStatus.Pending,
      attempts: 0,
    };
    model.findOne.mockReturnValue(queryResult(null));
    model.create.mockResolvedValue(record);
    model.findOneAndUpdate.mockReturnValue(queryResult(record));
    model.updateOne.mockReturnValue(queryResult({ modifiedCount: 1 }));

    await expect(service.enqueueAndDeliver(input)).resolves.toBeUndefined();

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: input.eventKey,
        status: TransactionalEmailStatus.Pending,
        expiresAt: expect.any(Date),
      }),
    );
    expect(email.sendTransactionalEmail).toHaveBeenCalledWith(
      input.recipient,
      input.eventKey,
      input.subject,
      input.body,
    );
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: record._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: TransactionalEmailStatus.Sent,
        }),
      }),
    );
  });

  it('un replay ya enviado no vuelve a llamar SMTP', async () => {
    model.findOne.mockReturnValue(
      queryResult({ ...input, status: TransactionalEmailStatus.Sent }),
    );

    await service.enqueueAndDeliver(input);

    expect(model.create).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('devuelve a pending con backoff cuando SMTP falla', async () => {
    const record = {
      _id: new Types.ObjectId(),
      ...input,
      status: TransactionalEmailStatus.Pending,
      attempts: 2,
    };
    model.findOne.mockReturnValue(queryResult(record));
    model.findOneAndUpdate.mockReturnValue(queryResult(record));
    model.updateOne.mockReturnValue(queryResult({ modifiedCount: 1 }));
    email.sendTransactionalEmail.mockRejectedValue(new Error('SMTP caído'));

    await expect(service.enqueueAndDeliver(input)).rejects.toThrow(
      'SMTP caído',
    );
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: record._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: TransactionalEmailStatus.Pending,
          attempts: 3,
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });
});
