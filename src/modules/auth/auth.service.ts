import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { verifyPassword } from './password';
import { User } from './schemas/user.schema';

export const tokenLifetimeSeconds = 3600;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly jwt: JwtService,
  ) {}

  async login({ phone, password }: LoginDto): Promise<LoginResponseDto> {
    const user = await this.users.findOne({ phone }).select('+passwordHash').exec();
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid) throw new UnauthorizedException('Invalid phone or password');

    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }, { expiresIn: tokenLifetimeSeconds }),
      tokenType: 'Bearer',
      expiresIn: tokenLifetimeSeconds,
    };
  }
}
