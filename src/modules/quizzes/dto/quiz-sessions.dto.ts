import { IsInt, IsOptional, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SingleAnswerDto } from './submit-quiz-attempt.dto';

export class SubmitSessionAnswersDto {
  @ApiProperty({ type: [SingleAnswerDto], description: 'List of submitted answers' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleAnswerDto)
  answers: SingleAnswerDto[];

  @ApiPropertyOptional({
    description: 'Passing score percentage threshold',
    default: 70,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passThreshold?: number;
}
