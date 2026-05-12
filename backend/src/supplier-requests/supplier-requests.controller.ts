import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CreateSupplierRequestDto } from './dto/create-supplier-request.dto';
import { SupplierRequestsService } from './supplier-requests.service';
import { UpdateSupplierRequestStatusDto } from './dto/update-supplier-request-status.dto';
import { ToggleSupplierRequestSyncDto } from './dto/toggle-supplier-request-sync.dto';

@Controller()
export class SupplierRequestsController {
  constructor(
    private readonly supplierRequestsService: SupplierRequestsService,
  ) {}

  @Post('supplier-requests')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  create(@Body() createSupplierRequestDto: CreateSupplierRequestDto) {
    return this.supplierRequestsService.create(createSupplierRequestDto);
  }

  @Patch('supplier-requests/:id/status')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  updateStatus(
    @Param('id') id: string,
    @Body() updateSupplierRequestStatusDto: UpdateSupplierRequestStatusDto,
  ) {
    return this.supplierRequestsService.updateStatus(id, updateSupplierRequestStatusDto);
  }

  @Post('supplier-requests/:id/sync')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  toggleSync(
    @Param('id') id: string,
    @Body() toggleSupplierRequestSyncDto: ToggleSupplierRequestSyncDto,
  ) {
    return this.supplierRequestsService.toggleSync(id, toggleSupplierRequestSyncDto);
  }

  @Get('supplier-requests')
  findAll(
    @Query('supplierName') supplierName?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.supplierRequestsService.findAll(supplierName, supplierId);
  }

  @Get('tickets/:id/supplier-requests')
  findByTicket(
    @Param('id') id: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.supplierRequestsService.findByTicket(id, supplierId);
  }
}
