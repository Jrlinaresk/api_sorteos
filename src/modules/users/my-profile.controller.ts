import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUserDto } from './dto/public-user.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UsersService } from './users.service';

@ApiTags('My profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/profile')
export class MyProfileController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  async update(@CurrentUser() user: PublicUserDto, @Body() dto: UpdateMyProfileDto) {
    return this.users.toPublicUser(await this.users.updateProfile(user.id, dto));
  }
}
