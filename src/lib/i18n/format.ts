import { format, type FormatOptions } from 'date-fns'
import { zhCN, enUS } from 'date-fns/locale'
import { useAppStore } from '@/stores/app-store'

export function getDisplayLocale() {
  return useAppStore.getState().language === 'zh' ? 'zh-CN' : 'en-US'
}

export function localizedFormat(date: Date | number | string, pattern: string, options?: FormatOptions) {
  const chinese = getDisplayLocale() === 'zh-CN'
  const patterns: Record<string, string> = { 'EEEE, MMMM d, yyyy': 'yyyy年M月d日 EEEE', 'EEEE, MMMM d': 'M月d日 EEEE', 'MMM d, yyyy': 'yyyy年M月d日', 'MMMM yyyy': 'yyyy年M月', 'MMM d': 'M月d日', 'h:mm a': 'HH:mm' }
  return format(date, chinese ? (patterns[pattern] || pattern) : pattern, { ...options, locale: chinese ? zhCN : enUS })
}
