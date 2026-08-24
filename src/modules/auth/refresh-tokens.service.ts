import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { RefreshSession, RefreshSessionDocument } from './schemas/refresh-session.schema';

export interface IssuedRefreshToken {
  token: string;
  userId: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokensService {
  constructor(
    @InjectModel(RefreshSession.name)
    private readonly sessions: Model<RefreshSessionDocument>,
    private readonly config: ConfigService,
  ) {}

  async issue(userId: string, familyId = randomUUID()): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.lifetimeDays() * 86_400_000);
    await this.sessions.create({
      user: new Types.ObjectId(userId),
      familyId,
      tokenHash: this.hash(token),
      expiresAt,
    });
    return { token, userId, expiresAt };
  }

  async rotate(token: string): Promise<IssuedRefreshToken> {
    const tokenHash = this.hash(token);
    const session = await this.sessions.findOne({ tokenHash }).exec();
    if (!session) throw this.invalid();
    if (session.revokedAt) {
      await this.revokeFamily(session.familyId, 'Reutilización de refresh token detectada');
      throw this.invalid();
    }
    if (session.expiresAt <= new Date()) {
      session.revokedAt = new Date();
      session.revokeReason = 'Expirado';
      await session.save();
      throw this.invalid();
    }

    const nextToken = randomBytes(48).toString('base64url');
    const nextHash = this.hash(nextToken);
    const revoked = await this.sessions.findOneAndUpdate(
      { _id: session._id, revokedAt: { $exists: false } },
      {
        $set: {
          revokedAt: new Date(),
          revokeReason: 'Rotado',
          replacedByTokenHash: nextHash,
        },
      },
      { new: true },
    );
    if (!revoked) {
      await this.revokeFamily(session.familyId, 'Refresh token usado en paralelo');
      throw this.invalid();
    }
    const expiresAt = new Date(Date.now() + this.lifetimeDays() * 86_400_000);
    await this.sessions.create({
      user: session.user,
      familyId: session.familyId,
      tokenHash: nextHash,
      expiresAt,
    });
    return { token: nextToken, userId: session.user.toString(), expiresAt };
  }

  async revoke(token: string, reason = 'Cierre de sesión') {
    await this.sessions.updateOne(
      { tokenHash: this.hash(token), revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokeReason: reason.slice(0, 160) } },
    );
  }

  async revokeAllForUser(userId: string, reason: string) {
    await this.sessions.updateMany(
      { user: new Types.ObjectId(userId), revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokeReason: reason.slice(0, 160) } },
    );
  }

  private async revokeFamily(familyId: string, reason: string) {
    await this.sessions.updateMany(
      { familyId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokeReason: reason.slice(0, 160) } },
    );
  }

  private lifetimeDays() {
    const value = Number(this.config.get<string>('JWT_REFRESH_DAYS') || 30);
    return Number.isFinite(value) ? Math.min(90, Math.max(1, Math.floor(value))) : 30;
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private invalid() {
    return new UnauthorizedException('Sesión de renovación inválida o vencida');
  }
}
