import { ApiProperty } from '@nestjs/swagger';
import { OperatorProfile } from '../domain/question-operator';

export class QuestionOperatorDto {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty({ type: String, description: '依次取昵称、邮箱，均为空时为“用户{id}”' })
  name: string;
}

export function operatorName(id: number, profile: OperatorProfile | undefined): string {
  const name = [profile?.nickname, profile?.email].map((value) => value?.trim()).find(Boolean);
  return name ?? `用户${id}`;
}

export function toQuestionOperator(
  id: number | null,
  profiles: ReadonlyMap<number, OperatorProfile>,
): QuestionOperatorDto | null {
  if (id === null) {
    return null;
  }
  return Object.assign(new QuestionOperatorDto(), { id, name: operatorName(id, profiles.get(id)) });
}
