import { validate } from 'class-validator';
import { MaxUtf8Bytes } from './max-utf8-bytes.validator';

class PasswordFixture {
  @MaxUtf8Bytes(72)
  password: string;
}

describe('MaxUtf8Bytes', () => {
  it('cuenta bytes UTF-8 y no solamente caracteres', async () => {
    const valid = new PasswordFixture();
    valid.password = 'á'.repeat(36);
    await expect(validate(valid)).resolves.toHaveLength(0);

    const invalid = new PasswordFixture();
    invalid.password = 'á'.repeat(37);
    await expect(validate(invalid)).resolves.toHaveLength(1);
  });
});
