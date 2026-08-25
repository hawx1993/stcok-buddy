import { useEffect, useState } from 'react';

const CHARACTER_DELAY_MS = 42;
const COMPLETED_PROMPT_DELAY_MS = 3_000;

export const QUICK_ENTRY_PROMPTS = [
  '试试 "/条件选股 --总市值=30-100亿 --换手率>8% --成交额>5亿 --排除ST"',
  '试试 "/复盘今日行情"',
  '试试 "/综合投研报告 300017"',
  '试试 "/新闻公告 600519"',
  '试试 "/题材归因"',
  '试试 "/全市场龙虎榜"',
  '试试 "/超短选股 帮我找近期强势股"',
  '试试 "/技术面分析 300017"',
  '试试 "/资金面分析 300017"',
  '试试 "/筹码分析 300017"',
] as const;

export function getNextQuickEntryPromptIndex(index: number) {
  return (index + 1) % QUICK_ENTRY_PROMPTS.length;
}

export function useRotatingQuickEntryPrompt() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const activePrompt = QUICK_ENTRY_PROMPTS[promptIndex];

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const isPromptComplete = visibleCharacters >= activePrompt.length;
    const timer = window.setTimeout(
      () => {
        if (isPromptComplete) {
          setPromptIndex((index) => getNextQuickEntryPromptIndex(index));
          setVisibleCharacters(0);
          return;
        }
        setVisibleCharacters((count) => count + 1);
      },
      isPromptComplete ? COMPLETED_PROMPT_DELAY_MS : CHARACTER_DELAY_MS,
    );

    return () => window.clearTimeout(timer);
  }, [activePrompt.length, prefersReducedMotion, visibleCharacters]);

  return prefersReducedMotion ? QUICK_ENTRY_PROMPTS[0] : activePrompt.slice(0, visibleCharacters);
}
