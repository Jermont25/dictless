import { useCallback, useRef, useState } from "react"

export type RecorderStatus = "idle" | "recording" | "stopping"

interface UseAudioRecorderResult {
  status: RecorderStatus
  seconds: number
  level: number
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<Blob | null>
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const [status, setStatus] = useState<RecorderStatus>("idle")
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close().catch(() => {})
    mediaRecorderRef.current = null
    streamRef.current = null
    audioCtxRef.current = null
    analyserRef.current = null
    rafRef.current = null
    timerRef.current = null
  }, [])

  const trackLevel = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)

    const loop = () => {
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128
        sumSquares += centered * centered
      }
      const rms = Math.sqrt(sumSquares / data.length)
      setLevel(Math.min(1, rms * 4))
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      audioCtxRef.current = audioCtx
      analyserRef.current = analyser
      trackLevel()

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : ""
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mediaRecorderRef.current = recorder
      recorder.start()

      setSeconds(0)
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1)
      }, 1000)

      setStatus("recording")
    } catch (err) {
      cleanup()
      setStatus("idle")
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(
          "Permiso de micrófono denegado. Actívalo en los ajustes del navegador.",
        )
      } else {
        setError("No se pudo acceder al micrófono.")
      }
    }
  }, [cleanup, trackLevel])

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || status !== "recording") {
        resolve(null)
        return
      }
      setStatus("stopping")
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        cleanup()
        setStatus("idle")
        setLevel(0)
        resolve(blob.size > 0 ? blob : null)
      }
      recorder.stop()
    })
  }, [cleanup, status])

  return { status, seconds, level, error, start, stop }
}
