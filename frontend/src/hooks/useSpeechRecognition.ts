import { useCallback, useEffect, useRef, useState } from 'react'

type RecCtor = new () => {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  onresult: ((ev: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
}

export function useSpeechRecognition() {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<InstanceType<RecCtor> | null>(null)

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    setSupported(Boolean(SR))
    if (SR) recRef.current = new SR() as InstanceType<RecCtor>
  }, [])

  const listen = useCallback(
    (onResult: (text: string) => void, onError?: (msg: string) => void) => {
      const rec = recRef.current
      if (!rec) {
        onError?.('Speech recognition not supported in this browser.')
        return
      }
      rec.continuous = false
      rec.interimResults = false
      rec.lang = 'en-US'
      rec.onresult = (ev) => {
        const text = ev.results[0]?.[0]?.transcript ?? ''
        onResult(text)
        setListening(false)
      }
      rec.onerror = (ev) => {
        onError?.(ev.error || 'speech_error')
        setListening(false)
      }
      rec.onend = () => setListening(false)
      try {
        setListening(true)
        rec.start()
      } catch {
        setListening(false)
        onError?.('Could not start microphone.')
      }
    },
    [],
  )

  return { supported, listening, listen }
}
