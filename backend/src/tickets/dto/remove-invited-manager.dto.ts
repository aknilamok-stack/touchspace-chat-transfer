import { IsNotEmpty, IsString } from 'class-validator';

export class RemoveInvitedManagerDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;
}
