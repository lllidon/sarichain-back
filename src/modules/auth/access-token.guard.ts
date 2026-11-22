import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @InjectModel(User.name) private readonly users: Model<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; userId?: string }>();
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();

    try {
      const claims = await this.jwt.verifyAsync<{ sub?: unknown }>(token, { algorithms: ['HS256'] });
      if (typeof claims.sub !== 'string' || !isObjectIdOrHexString(claims.sub) ||
          !await this.users.exists({ _id: claims.sub, isActive: { $ne: false } })) throw new UnauthorizedException();
      request.userId = claims.sub;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
