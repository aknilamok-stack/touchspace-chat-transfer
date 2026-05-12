import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const updatableSupplierRequestStatuses = [
  'pending',
  'in_progress',
  'answered',
  'closed',
  'cancelled',
] as const;

export class UpdateSupplierRequestStatusDto {
  @IsString()
  @IsIn(updatableSupplierRequestStatuses)
  status: (typeof updatableSupplierRequestStatuses)[number];

  @IsOptional()
  @IsString()
  assignedSupplierProfileId?: string;

  @IsOptional()
  @IsString()
  assignedSupplierProfileName?: string;

  @IsOptional()
  @IsBoolean()
  clearAssignedSupplier?: boolean;
}
