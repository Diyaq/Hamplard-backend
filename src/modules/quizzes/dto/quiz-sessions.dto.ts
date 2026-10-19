import { IsInt, IsOptional, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SingleAnswerDto } from './submit-quiz-attempt.dto';

export class SubmitSessionAnswersDto {
  // No passThreshold here (#236): grading uses the lesson's stored threshold.
  @ApiProperty({ type: [SingleAnswerDto], description: 'List of submitted answers' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleAnswerDto)
  answers: SingleAnswerDto[];
}
