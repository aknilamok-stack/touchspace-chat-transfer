import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { AdminAiService } from './admin-ai.service';
import { AdminService } from './admin.service';

type AdminRequest = Request & {
  adminContext?: {
    adminId: string;
    adminName?: string;
  };
};

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAiService: AdminAiService,
  ) {}

  @Get('overview')
  getOverview(
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getOverview({ preset, dateFrom, dateTo });
  }

  @Get('registrations')
  getRegistrations(
    @Query('role') role?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.getRegistrations({ role, status });
  }

  @Get('registrations/:id')
  getRegistration(@Param('id') id: string) {
    return this.adminService.getRegistration(id);
  }

  @Post('registrations')
  createRegistration(
    @Body()
    body: {
      fullName: string;
      email: string;
      role: string;
      companyName?: string;
      comment?: string;
    },
  ) {
    return this.adminService.createRegistration(body);
  }

  @Patch('registrations/:id/approve')
  approveRegistration(
    @Param('id') id: string,
    @Body()
    body?: {
      adminId?: string;
      comment?: string;
    },
  ) {
    return this.adminService.approveRegistration(id, body);
  }

  @Patch('registrations/:id/reject')
  rejectRegistration(
    @Param('id') id: string,
    @Body()
    body?: {
      adminId?: string;
      comment?: string;
    },
  ) {
    return this.adminService.rejectRegistration(id, body);
  }

  @Get('users')
  getUsers(
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('company') company?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getUsers({
      role,
      status,
      company,
      dateFrom,
      dateTo,
    });
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Post('users')
  createUser(
    @Req() request: AdminRequest,
    @Body()
    body: {
      fullName?: string;
      email?: string;
      authLogin?: string;
      password?: string;
      role: string;
      companyName?: string;
      createdByAdminId?: string;
      status?: string;
    },
  ) {
    return this.adminService.createUser(body, request.adminContext);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body()
    body: {
      role?: string;
      status?: string;
      isActive?: boolean;
      companyName?: string;
      fullName?: string;
      email?: string | null;
      authLogin?: string | null;
      supervisorProfileId?: string | null;
      approvalStatus?: string;
      lastLoginAt?: string | null;
    },
  ) {
    return this.adminService.updateUser(id, body);
  }

  @Post('users/:id/reissue-password')
  reissueUserPassword(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.adminService.reissueUserPassword(id, request.adminContext);
  }

  @Delete('users/:id')
  deleteUser(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.adminService.deleteUser(id, request.adminContext);
  }

  @Get('dialogs')
  getDialogs(
    @Query('status') status?: string,
    @Query('managerId') managerId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('supplierEscalated') supplierEscalated?: string,
    @Query('slaBreached') slaBreached?: string,
  ) {
    return this.adminService.getDialogs({
      status,
      managerId,
      supplierId,
      preset,
      dateFrom,
      dateTo,
      supplierEscalated,
      slaBreached,
    });
  }

  @Get('dialogs/:id')
  getDialog(
    @Param('id') id: string,
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getDialog(id, { preset, dateFrom, dateTo });
  }

  @Post('dialogs/:id/ai-analyze')
  analyzeDialog(@Param('id') id: string) {
    return this.adminAiService.analyzeDialog(id);
  }

  @Post('dialogs/:id/client-ai-summary')
  generateClientDialogAiSummary(
    @Param('id') id: string,
    @Body()
    body?: {
      preset?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.adminAiService.generateClientDialogSummary(id, body);
  }

  @Get('analytics/overview')
  getAnalyticsOverview(
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getAnalyticsOverview({
      preset,
      dateFrom,
      dateTo,
    });
  }

  @Get('analytics/managers')
  getManagerAnalytics(
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getManagerAnalytics({
      preset,
      dateFrom,
      dateTo,
    });
  }

  @Get('analytics/managers/:id')
  getManagerAnalyticsDetail(
    @Param('id') id: string,
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getManagerAnalyticsDetail(id, {
      preset,
      dateFrom,
      dateTo,
    });
  }

  @Get('analytics/suppliers')
  getSupplierAnalytics(
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('companyName') companyName?: string,
  ) {
    return this.adminService.getSupplierAnalytics({
      preset,
      dateFrom,
      dateTo,
      companyName,
    });
  }

  @Get('analytics/suppliers/:id')
  getSupplierAnalyticsDetail(
    @Param('id') id: string,
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getSupplierAnalyticsDetail(id, {
      preset,
      dateFrom,
      dateTo,
    });
  }

  @Get('analytics/insights')
  getInsightsAnalytics(
    @Query('preset') preset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getInsightsAnalytics({
      preset,
      dateFrom,
      dateTo,
    });
  }

  @Post('analytics/insights/ai-summary')
  generateInsightsAiSummary(
    @Body()
    body?: {
      preset?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.adminAiService.generateInsightsSummary(body);
  }

  @Post('analytics/reasons/ai-summary')
  generateReasonsAiSummary(
    @Body()
    body?: {
      preset?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.adminAiService.generateReasonsSummary(body);
  }

  @Get('sla')
  getSlaSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getSlaSummary({
      dateFrom,
      dateTo,
    });
  }
}
