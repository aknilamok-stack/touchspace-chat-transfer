import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SupervisorsService } from './supervisors.service';

@Controller('supervisors')
export class SupervisorsController {
  constructor(private readonly supervisorsService: SupervisorsService) {}

  @Get('supplier-companies')
  listSupplierCompanies() {
    return this.supervisorsService.listSupplierCompanies();
  }

  @Get('operators')
  listOperators(@Query('supervisorId') supervisorId: string) {
    return this.supervisorsService.listOperators(supervisorId);
  }

  @Get('analytics')
  getAnalytics(
    @Query('supervisorId') supervisorId: string,
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.supervisorsService.getAnalytics(supervisorId, {
      preset,
      dateFrom,
      dateTo,
    });
  }

  @Patch('operators/:id/chat-access')
  updateOperatorChatAccess(
    @Param('id') operatorId: string,
    @Body()
    body: {
      supervisorId: string;
      enabled: boolean;
    },
  ) {
    return this.supervisorsService.updateOperatorChatAccess(
      body.supervisorId,
      operatorId,
      body.enabled,
    );
  }

  @Patch('operators/:id/account')
  updateOperatorAccount(
    @Param('id') operatorId: string,
    @Body()
    body: {
      supervisorId: string;
      authLogin?: string;
      email?: string | null;
    },
  ) {
    return this.supervisorsService.updateOperatorAccount(
      body.supervisorId,
      operatorId,
      {
        authLogin: body.authLogin,
        email: body.email,
      },
    );
  }

  @Post('operators')
  createOperator(
    @Body()
    body: {
      supervisorId: string;
      fullName?: string;
      email?: string | null;
      password?: string;
    },
  ) {
    return this.supervisorsService.createOperator(body.supervisorId, {
      fullName: body.fullName,
      email: body.email,
      password: body.password,
    });
  }

  @Patch('operators/:id/activation')
  updateOperatorActivation(
    @Param('id') operatorId: string,
    @Body()
    body: {
      supervisorId: string;
      enabled: boolean;
    },
  ) {
    return this.supervisorsService.updateOperatorActivation(
      body.supervisorId,
      operatorId,
      body.enabled,
    );
  }

  @Post('operators/:id/reissue-password')
  reissueOperatorPassword(
    @Param('id') operatorId: string,
    @Body()
    body: {
      supervisorId: string;
    },
  ) {
    return this.supervisorsService.reissueOperatorPassword(
      body.supervisorId,
      operatorId,
    );
  }
}
