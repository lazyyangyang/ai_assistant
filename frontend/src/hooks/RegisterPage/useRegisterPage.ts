import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { t } from '@/lib/i18n'

export function useRegisterPage() {
  const { register } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await register(username, email, password)
      toast({ title: t('RegisterPage.successTitle'), message: t('RegisterPage.successMessage'), variant: 'success' })
      navigate('/login', { replace: true })
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: t('RegisterPage.failureTitle'), message: msg, variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return {
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    error,
    loading,
    handleSubmit,
  }
}
