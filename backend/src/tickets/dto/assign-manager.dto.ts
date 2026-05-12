import { IsNotEmpty, IsString } from 'class-validator';

export class AssignManagerDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsString()
  @IsNotEmpty()
  managerName: string;
}
