import { IsIn, IsOptional, IsString } from 'class-validator';

const supplierRequestSyncActions = [
  'pause',
  'resume',
  'resume_request',
  'resume_defer',
] as const;
const supplierRequestSyncActorTypes = ['manager', 'supplier'] as const;

export class ToggleSupplierRequestSyncDto {
  @IsIn(supplierRequestSyncActions)
  action!: (typeof supplierRequestSyncActions)[number];

  @IsIn(supplierRequestSyncActorTypes)
  actorType!: (typeof supplierRequestSyncActorTypes)[number];

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  actorName?: string;
}
