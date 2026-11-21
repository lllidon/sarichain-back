import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { hashPassword, verifyPassword } from './password';
import { User } from './schemas/user.schema';

export const tokenLifetimeSeconds = 3600;
const initialAdminUsername = 'milad';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly jwt: JwtService,
  ) {}

  async initializeAdmin(password?: string): Promise<void> {
    if (!password || await this.users.exists({})) return;
    await this.users.init();
    const passwordHash = await hashPassword(password);

    // Check again after hashing. Parallel instances share the same bootstrap identity.
    if (await this.users.exists({})) return;
    try {
      await this.users.create({ username: initialAdminUsername, role: 'admin', passwordHash });
      Logger.log('Initial admin account created.', AuthService.name);
    } catch (error) {
      const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
      if (!duplicate || !await this.users.exists({})) throw error;
    }
  }

  async login({ phone, username, password }: LoginDto): Promise<LoginResponseDto> {
    if (Boolean(phone) === Boolean(username)) throw new BadRequestException('Provide either phone or username.');
    const user = await this.users.findOne(phone ? { phone } : { username }).select('+passwordHash').exec();
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid) throw new UnauthorizedException('Invalid username, phone or password');

    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }, { expiresIn: tokenLifetimeSeconds }),
      tokenType: 'Bearer',
      expiresIn: tokenLifetimeSeconds,
    };
  }
}
