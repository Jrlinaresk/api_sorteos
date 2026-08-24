import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardRangeDto } from './dto/dashboard-range.dto';

@ApiTags('Admin dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Resumen operativo y financiero del panel' })
  summary(@Query() query: DashboardRangeDto) {
    return this.dashboard.summary(query.days);
  }
}
