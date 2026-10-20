import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateCouponDto {
  @ApiProperty({ example: 'SAVE20', description: 'Coupon code to validate' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'COURSE-TAILORING-001', description: 'Course the coupon is being applied to' })
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @ApiProperty({
    required: false,
    deprecated: true,
    example: 50,
    description: 'Ignored — the course price is always looked up server-side',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  originalPrice?: number;
}
