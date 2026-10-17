import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class SubmitAssignmentDto {
  @ApiProperty({
    example: 'https://cdn.hamplard.com/uploads/assignments/garment.jpg',
    description: 'URL of the uploaded submission (http/https only)',
  })
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  submissionUrl: string;

  @ApiPropertyOptional({ example: 'Used French seams on the side panels.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
