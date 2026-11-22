import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async canActivate(context: ExecutionContext) {
    const { userId } = context.switchToHttp().getRequest<{ userId?: string }>();
    if (!isValidObjectId(userId) || !await this.users.exists({ _id: userId, role: 'admin' })) {
      throw new ForbiddenException('دسترسی مدیر لازم است.');
    }
    return true;
  }
}
