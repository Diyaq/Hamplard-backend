import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RedeemCouponDto {
  @ApiProperty({ description: 'ID of the coupon being redeemed' })
  @IsString()
  @IsNotEmpty()
  couponId: string;

  @ApiProperty({
    description:
      'ID of the caller\'s verified enrollment the coupon was applied to. '
      + 'The course and discount are derived server-side from this enrollment.',
  })
  @IsString()
  @IsNotEmpty()
  enrollmentId: string;
}
