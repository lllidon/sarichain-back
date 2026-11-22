import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { clientAccessKey, type AccessContext } from './access';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @InjectModel(User.name) private readonly users: Model<User>, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; userId?: string; access?: AccessContext }>();
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();

    let userId: string;
    try {
      const claims = await this.jwt.verifyAsync<{ sub?: unknown }>(token, { algorithms: ['HS256'] });
      if (typeof claims.sub !== 'string' || !isObjectIdOrHexString(claims.sub)) throw new Error();
      userId = claims.sub;
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.users.findOne({ _id: userId, isActive: { $ne: false } })
      .select('role branchId profileId fullName username').lean();
    if (!user) throw new UnauthorizedException();
    const role = user.role ?? 'client';
    if (role === 'client' && !this.reflector.get<boolean>(clientAccessKey, context.getHandler())) {
      throw new ForbiddenException('دسترسی کلاینت محدود به سفارش‌های شعبه است.');
    }
    request.userId = userId;
    request.access = { id: userId, role, branchId: user.branchId?.toString(),
      profileId: user.profileId?.toString(), name: user.fullName || user.username };
    return true;
  }
}
