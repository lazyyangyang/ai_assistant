import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { t } from '@/lib/i18n'

export function useLoginPage() {
  const { login } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      toast({ title: t('LoginPage.successTitle'), message: t('LoginPage.successMessage'), variant: 'success' })
      navigate('/')
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: t('LoginPage.failureTitle'), message: msg, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    error,
    loading,
    handleSubmit,
  }
}
