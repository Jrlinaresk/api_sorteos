// modules/email/email.module.ts
import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailVerificationService } from './email-verification.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmailVerification,
  EmailVerificationSchema,
} from './schema/email-verification.schema';
import { ConfigModule } from '@nestjs/config';
import {
  TransactionalEmail,
  TransactionalEmailSchema,
} from './schema/transactional-email.schema';
import { TransactionalEmailService } from './transactional-email.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: EmailVerification.name, schema: EmailVerificationSchema },
      { name: TransactionalEmail.name, schema: TransactionalEmailSchema },
    ]),
  ],
  controllers: [],
  providers: [
    EmailService,
    EmailVerificationService,
    TransactionalEmailService,
  ],
  exports: [EmailService, EmailVerificationService, TransactionalEmailService],
})
export class EmailModule {}
