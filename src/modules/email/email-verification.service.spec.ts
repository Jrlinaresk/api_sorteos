import { EmailVerificationService } from './email-verification.service';

function query<T>(value: T | Promise<T>) {
  const result: Record<string, jest.Mock> = {
    exec: jest.fn().mockImplementation(() => Promise.resolve(value)),
  };
  result.select = jest.fn().mockReturnValue(result);
  return result;
}

describe('EmailVerificationService concurrency and cooldown', () => {
  const secret = 'email-verification-secret-with-32-characters';
  let model: Record<string, jest.Mock>;
  let email: Record<string, jest.Mock>;
  let service: EmailVerificationService;

  beforeEach(() => {
    model = {
      findOneAndUpdate: jest.fn(),
      findOneAndDelete: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    };
    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new EmailVerificationService(
      model as never,
      email as never,
      { get: jest.fn().mockReturnValue(secret) } as never,
    );
  });

  it('reserva el cooldown de forma atómica antes de enviar el código', async () => {
    const document = { _id: 'verification-1' };
    model.findOneAndUpdate.mockReturnValue(query(document));

    await service.createVerificationCode(' USER@example.com ');

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        $or: expect.any(Array),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          email: 'user@example.com',
          codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          attempts: 0,
        }),
      }),
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('traduce la carrera del índice único en un cooldown genérico', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 11000 });
    const failed = query(null);
    failed.exec.mockRejectedValue(duplicate);
    model.findOneAndUpdate.mockReturnValue(failed);

    await expect(
      service.createVerificationCode('user@example.com'),
    ).rejects.toMatchObject({ status: 429 });
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('consume un código correcto con delete condicional de un solo ganador', async () => {
    const createdAt = new Date();
    const code = '123456';
    const codeHash = (service as any).hash('user@example.com', code);
    const record = {
      _id: 'verification-1',
      email: 'user@example.com',
      codeHash,
      attempts: 1,
      createdAt,
    };
    model.findOneAndUpdate.mockReturnValue(query(record));
    model.findOneAndDelete
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(null);

    await expect(
      service.verifyCode('user@example.com', code),
    ).resolves.toBeUndefined();
    await expect(
      service.verifyCode('user@example.com', code),
    ).rejects.toThrow('Código de verificación inválido o expirado');

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { email: 'user@example.com', attempts: { $lt: 5 } },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    expect(model.findOneAndDelete).toHaveBeenCalledWith({
      _id: record._id,
      createdAt,
      codeHash,
    });
  });
});
