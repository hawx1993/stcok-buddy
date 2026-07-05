import { normalizeSymbol as sdkNormalizeSymbol } from 'stock-sdk/symbols';

const commonNames: Record<string, string> = {
  茅台: '600519',
  贵州茅台: '600519',
  五粮液: '000858',
  泸州老窖: '000568',
  洋河股份: '002304',
  招商银行: '600036',
  招行: '600036',
  宁德时代: '300750',
  宁王: '300750',
  比亚迪: '002594',
  中信证券: '600030',
};

export function extractSymbolCandidate(input: string): string {
  const direct = input.match(/\b\d{6}\b/);
  if (direct) return direct[0];

  for (const [name, code] of Object.entries(commonNames)) {
    if (input.includes(name)) return code;
  }

  return input.trim();
}

export function normalizeASymbol(input: string): string {
  const candidate = extractSymbolCandidate(input);
  try {
    const normalized = sdkNormalizeSymbol(candidate);
    return normalized.code;
  } catch {
    return candidate;
  }
}

export function inferExchange(code: string): string {
  if (code.startsWith('6')) return '沪市';
  if (code.startsWith('0') || code.startsWith('3')) return '深市';
  if (code.startsWith('8') || code.startsWith('4')) return '北交所';
  return 'A股';
}
