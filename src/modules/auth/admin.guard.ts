import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import type { AccessRequest } from './access';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<AccessRequest>().access?.role !== 'management') {
      throw new ForbiddenException('دسترسی مدیریت لازم است.');
    }
    return true;
  }
}
