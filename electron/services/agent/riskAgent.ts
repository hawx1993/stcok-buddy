const disclaimer = '以上内容基于公开数据自动生成，仅供研究参考，不构成投资建议。';

const forbiddenPatterns = [
  /建议\s*(买入|卖出|加仓|清仓|满仓|重仓)/g,
  /(可以买入|应该买入|应该卖出|立即买|马上卖|目标买点)/g,
  /(强烈推荐|稳赚|必涨|包赚)/g,
];

export function reviewCompliance(text: string): string {
  let reviewed = text;
  for (const pattern of forbiddenPatterns) {
    reviewed = reviewed.replace(pattern, '可作为研究关注点');
  }
  if (!reviewed.includes('不构成投资建议')) {
    reviewed = `${reviewed.trim()}\n\n${disclaimer}`;
  }
  return reviewed;
}
