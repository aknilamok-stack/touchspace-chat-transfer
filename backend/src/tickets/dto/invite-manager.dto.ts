import { IsNotEmpty, IsString } from 'class-validator';

export class InviteManagerDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsString()
  @IsNotEmpty()
  managerName: string;
}
