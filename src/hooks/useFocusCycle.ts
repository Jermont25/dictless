import { useEffect, useRef, useState } from "react"

export type FocusCyclePhase = "focus" | "break"
export type FocusCycleStatus = "idle" | "running" | "paused" | "complete"

type FocusCycleOptions = {
  focusMinutes: number
  breakMinutes: number
  isScheduleActive: () => boolean
  isScheduleClosed: () => boolean
  onPhaseTransition: () => void
}

export function useFocusCycle({
  focusMinutes,
  breakMinutes,
  isScheduleActive,
  isScheduleClosed,
  onPhaseTransition,
}: FocusCycleOptions) {
  const [phase, setPhase] = useState<FocusCyclePhase>("focus")
  const [status, setStatus] = useState<FocusCycleStatus>("idle")
  const [remainingSeconds, setRemainingSeconds] = useState(focusMinutes * 60)
  const deadlineRef = useRef<number | null>(null)
  const stopAfterPhaseRef = useRef(false)

  useEffect(() => {
    if (status !== "running") return

    const interval = window.setInterval(() => {
      const deadline = deadlineRef.current
      if (!deadline) return

      if (isScheduleClosed()) stopAfterPhaseRef.current = true

      const nextRemainingSeconds = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000),
      )
      setRemainingSeconds(nextRemainingSeconds)

      if (nextRemainingSeconds > 0) return

      deadlineRef.current = null
      onPhaseTransition()

      if (stopAfterPhaseRef.current || !isScheduleActive()) {
        setStatus("complete")
        return
      }

      const nextPhase = phase === "focus" ? "break" : "focus"
      const nextDuration = nextPhase === "focus" ? focusMinutes : breakMinutes
      setPhase(nextPhase)
      setRemainingSeconds(nextDuration * 60)
      deadlineRef.current = Date.now() + nextDuration * 60_000
    }, 250)

    return () => window.clearInterval(interval)
  }, [
    breakMinutes,
    focusMinutes,
    isScheduleActive,
    isScheduleClosed,
    onPhaseTransition,
    phase,
    status,
  ])

  function start() {
    if (!isScheduleActive()) return false

    stopAfterPhaseRef.current = false
    setPhase("focus")
    setRemainingSeconds(focusMinutes * 60)
    deadlineRef.current = Date.now() + focusMinutes * 60_000
    setStatus("running")
    return true
  }

  function pause() {
    const deadline = deadlineRef.current
    if (!deadline) return

    setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    deadlineRef.current = null
    setStatus("paused")
  }

  function resume() {
    if (!isScheduleActive()) return false

    deadlineRef.current = Date.now() + remainingSeconds * 1000
    setStatus("running")
    return true
  }

  function reset(nextFocusMinutes = focusMinutes) {
    deadlineRef.current = null
    stopAfterPhaseRef.current = false
    setPhase("focus")
    setRemainingSeconds(nextFocusMinutes * 60)
    setStatus("idle")
  }

  return { phase, status, remainingSeconds, start, pause, resume, reset }
}
