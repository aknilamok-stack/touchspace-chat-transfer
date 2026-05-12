import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

const supplierRequestStatuses = [
  'pending',
  'sent',
  'in_progress',
  'answered',
  'closed',
  'cancelled',
] as const;

export class CreateSupplierRequestDto {
  @IsString()
  @MinLength(1)
  ticketId: string;

  @IsOptional()
  @IsString()
  supplierId?: string | null;

  @IsString()
  @MinLength(1)
  supplierName: string;

  @IsString()
  @MinLength(1)
  requestText: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slaMinutes?: number | null;

  @IsOptional()
  @IsString()
  createdByManagerId?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(supplierRequestStatuses)
  status?: (typeof supplierRequestStatuses)[number];
}
