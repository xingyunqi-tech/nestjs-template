import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import llmConfig from './config/llm.config';
import { LlmProvider } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './providers/openai-compatible-llm.provider';

@Module({
  imports: [ConfigModule.forFeature(llmConfig)],
  providers: [{ provide: LlmProvider, useClass: OpenAiCompatibleLlmProvider }],
  exports: [LlmProvider],
})
export class LlmModule {}
