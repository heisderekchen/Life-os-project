import { describe, it, expect } from 'vitest'
import { availableLanguages, en, zh, tr, es, de, fr, getTranslation } from '@/lib/i18n'

describe('i18n', () => {
  describe('availableLanguages', () => {
    it('should have 6 supported languages', () => {
      expect(availableLanguages).toHaveLength(6)
    })

    it('should include all required language codes', () => {
      const codes = availableLanguages.map(lang => lang.code)
      expect(codes).toContain('en')
      expect(codes).toContain('zh')
      expect(codes).toContain('tr')
      expect(codes).toContain('es')
      expect(codes).toContain('de')
      expect(codes).toContain('fr')
    })

    it('should have proper metadata for each language', () => {
      availableLanguages.forEach(lang => {
        expect(lang).toHaveProperty('code')
        expect(lang).toHaveProperty('label')
        expect(lang).toHaveProperty('nativeLabel')
        expect(lang).toHaveProperty('flag')
      })
    })
  })

  describe('translation exports', () => {
    it('should export all translation objects', () => {
      expect(en).toBeDefined()
      expect(tr).toBeDefined()
      expect(es).toBeDefined()
      expect(de).toBeDefined()
      expect(fr).toBeDefined()
    })

    it('should have common structure in English', () => {
      expect(en).toHaveProperty('appName')
      expect(typeof en.appName).toBe('string')
    })
  })

  it('translates task selection controls in every supported language', () => {
    const expected = {
      en: ['Select', 'Deselect', 'Select all', 'Deselect all'],
      zh: ['选择', '取消选择', '全选', '取消全选'],
      tr: ['Seç', 'Seçimi kaldır', 'Tümünü seç', 'Tümünün seçimini kaldır'],
      es: ['Seleccionar', 'Deseleccionar', 'Seleccionar todo', 'Deseleccionar todo'],
      de: ['Auswählen', 'Auswahl aufheben', 'Alle auswählen', 'Auswahl aufheben'],
      fr: ['Sélectionner', 'Désélectionner', 'Tout sélectionner', 'Tout désélectionner'],
    } as const

    for (const [language, values] of Object.entries(expected)) {
      const { selection } = (getTranslation(language) as typeof en).tasks
      expect([selection.select, selection.deselect, selection.selectAll, selection.deselectAll]).toEqual(values)
    }
  })

  describe('all locales have the same keys as English', () => {
    function getNestedKeys(obj: any, prefix = ''): string[] {
      let keys: string[] = []
      for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && obj[key] !== null) {
          keys = keys.concat(getNestedKeys(obj[key], fullKey))
        } else {
          keys.push(fullKey)
        }
      }
      return keys
    }

    it('Chinese has same keys as English', () => { expect(getNestedKeys(zh).sort()).toEqual(getNestedKeys(en).sort()) })

    it('Turkish has same keys as English', () => {
      const enKeys = getNestedKeys(en).sort()
      const trKeys = getNestedKeys(tr).sort()
      expect(trKeys).toEqual(enKeys)
    })

    it('Spanish has same keys as English', () => {
      const enKeys = getNestedKeys(en).sort()
      const esKeys = getNestedKeys(es).sort()
      expect(esKeys).toEqual(enKeys)
    })

    it('German has same keys as English', () => {
      const enKeys = getNestedKeys(en).sort()
      const deKeys = getNestedKeys(de).sort()
      expect(deKeys).toEqual(enKeys)
    })

    it('French has same keys as English', () => {
      const enKeys = getNestedKeys(en).sort()
      const frKeys = getNestedKeys(fr).sort()
      expect(frKeys).toEqual(enKeys)
    })
  })

  describe('getTranslation helper', () => {
    it('should return English translation for "en"', () => {
      const trans = getTranslation('en')
      expect(trans).toBeDefined()
      expect(trans).toEqual(en)
    })

    it('should return Turkish translation for "tr"', () => {
      const trans = getTranslation('tr')
      expect(trans).toEqual(tr)
    })

    it('should fallback to English for unknown locale', () => {
      const trans = getTranslation('unknown')
      expect(trans).toEqual(en)
    })

    it('should return translation objects with appName', () => {
      const locales = ['en', 'tr', 'es', 'de', 'fr']
      locales.forEach(locale => {
        const trans = getTranslation(locale)
        expect(trans).toHaveProperty('appName')
        expect(typeof trans.appName).toBe('string')
      })
    })
  })
})
