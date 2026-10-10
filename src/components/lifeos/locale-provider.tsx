'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const language = useAppStore(s => s.language)
  useEffect(() => {
    let savedLanguage: string | undefined
    try { savedLanguage = JSON.parse(localStorage.getItem('lifeos-app-store') || '{}').state?.language } catch {}
    if (!savedLanguage) useAppStore.getState().setLanguage(/^zh/i.test(navigator.language) ? 'zh' : 'en')
  }, [])
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language
  }, [language])
  return children
}
