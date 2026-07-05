import { z } from 'zod';

export const SymbolInputSchema = z.string().trim().min(1, '请输入股票代码或名称');

export const KlineOptionsSchema = z.object({
  symbol: SymbolInputSchema,
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  limit: z.number().int().min(20).max(300).default(120),
});
