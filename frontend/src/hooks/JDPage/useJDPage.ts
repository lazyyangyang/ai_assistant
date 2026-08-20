import { useMemo, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { t } from '@/lib/i18n'
import { hasMeaningfulJdResult, saveJdResult } from '@/lib/jdStorage'
import { useChatStore } from '@/stores/chatStore'

export function useJDPage() {
  const { toast } = useToast()
  const structured = useChatStore((state) => state.structuredByAgent.jd)
  const [savedAt, setSavedAt] = useState('')

  const canSave = useMemo(() => hasMeaningfulJdResult(structured), [structured])

  const handleSave = () => {
    if (!structured) return

    saveJdResult(structured)
    setSavedAt(new Date().toLocaleString())
    toast({ title: t('JDPage.saveSuccessTitle'), message: t('JDPage.saveSuccessMessage'), variant: 'success' })
  }

  return {
    structured,
    savedAt,
    canSave,
    handleSave,
  }
}
