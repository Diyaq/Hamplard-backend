import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ description: 'Discussion thread identifier (the ID of the course the discussion belongs to)' })
  @IsString()
  @IsNotEmpty()
  discussionId: string;

  @ApiProperty({ description: 'Comment content to be scanned for banned terms' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
