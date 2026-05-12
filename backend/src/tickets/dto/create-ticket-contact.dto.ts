import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateTicketContactDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  managerName: string;

  @IsString()
  @IsIn(['email', 'phone'])
  type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  @Matches(/\S/, { message: 'value should not be empty' })
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class UpdateTicketContactDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  managerName: string;

  @IsOptional()
  @IsString()
  @IsIn(['email', 'phone'])
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/\S/, { message: 'value should not be empty' })
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class DeleteTicketContactDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  managerName: string;
}
