import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react"
import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Info,
  Languages,
  Loader2,
  Mic,
  Save,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAudioRecorder } from "@/hooks/useAudioRecorder"
import { useFocusCycle } from "@/hooks/useFocusCycle"
import {
  getTranscribeModel,
  isFileTranscribeModel,
  transcribeAudio,
  TRANSCRIBE_MODELS,
  type FileTranscribeModel,
} from "@/lib/openai"

const MODEL_STORAGE = "dictado_openai_model"
const DAY_SCHEDULE_STORAGE = "dictless_day_schedule"
const FOCUS_CYCLE_STORAGE = "dictless_focus_cycle"
const DEFAULT_DAY_SCHEDULE = { start: "08:00", end: "18:00" }
const DEFAULT_FOCUS_CYCLE = { focusMinutes: 60, breakMinutes: 5 }
let phaseTransitionContext: AudioContext | null = null

type DaySchedule = typeof DEFAULT_DAY_SCHEDULE
type FocusCycleSettings = typeof DEFAULT_FOCUS_CYCLE
type AppSection = "dictation" | "time"

const SECTION_ORDER: AppSection[] = ["dictation", "time"]

const CONTEXT_PRESETS = [
  {
    label: "Mensaje de Slack",
    value: "Estoy dictando un mensaje que voy a enviar por Slack.",
  },
  {
    label: "Instrucción a agente de IA",
    value: "Estoy dictando un mensaje con instrucciones para un agente de IA.",
  },
  {
    label: "Tarea",
    value: "Estoy redactando los detalles de una tarea.",
  },
] as const

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")
  const s = (totalSeconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

function csvValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function readDaySchedule(): DaySchedule {
  try {
    const saved = localStorage.getItem(DAY_SCHEDULE_STORAGE)
    if (!saved) return DEFAULT_DAY_SCHEDULE

    const parsed = JSON.parse(saved) as Partial<DaySchedule>
    if (isValidTime(parsed.start) && isValidTime(parsed.end)) {
      return { start: parsed.start, end: parsed.end }
    }
  } catch {
    return DEFAULT_DAY_SCHEDULE
  }

  return DEFAULT_DAY_SCHEDULE
}

function isValidCycleDuration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 240
  )
}

function readFocusCycleSettings(): FocusCycleSettings {
  try {
    const saved = localStorage.getItem(FOCUS_CYCLE_STORAGE)
    if (!saved) return DEFAULT_FOCUS_CYCLE

    const parsed = JSON.parse(saved) as Partial<FocusCycleSettings>
    if (
      isValidCycleDuration(parsed.focusMinutes) &&
      isValidCycleDuration(parsed.breakMinutes)
    ) {
      return {
        focusMinutes: parsed.focusMinutes,
        breakMinutes: parsed.breakMinutes,
      }
    }
  } catch {
    return DEFAULT_FOCUS_CYCLE
  }

  return DEFAULT_FOCUS_CYCLE
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number)
  return hours * 60 + minutes
}

function formatTimeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number)
  const twelveHour = hours % 12 || 12
  const period = hours >= 12 ? "p. m." : "a. m."
  return `${twelveHour}:${minutes.toString().padStart(2, "0")} ${period}`
}

function formatDuration(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  if (hours === 0) return `${remainder} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

function getPhaseTransitionContext() {
  if (!phaseTransitionContext || phaseTransitionContext.state === "closed") {
    phaseTransitionContext = new AudioContext()
  }

  return phaseTransitionContext
}

function preparePhaseTransitionSound() {
  try {
    void getPhaseTransitionContext().resume()
  } catch {
    return
  }
}

function playPhaseTransitionSound() {
  try {
    const context = getPhaseTransitionContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime

    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(740, now)
    oscillator.frequency.exponentialRampToValueAtTime(988, now + 0.16)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.23)
  } catch {
    return
  }
}

function formatCurrentTime(date: Date) {
  return date.toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  })
}

function getDayProgress(schedule: DaySchedule, date: Date) {
  const currentMinutes = date.getHours() * 60 + date.getMinutes()
  const start = timeToMinutes(schedule.start)
  const end = timeToMinutes(schedule.end)
  const total = end > start ? end - start : end + 24 * 60 - start

  let elapsed = currentMinutes - start
  if (end <= start && currentMinutes < end) elapsed += 24 * 60
  if (end <= start && currentMinutes >= end && currentMinutes < start)
    elapsed = total

  const boundedElapsed = Math.min(Math.max(elapsed, 0), total)
  const progress = total > 0 ? (boundedElapsed / total) * 100 : 0

  return {
    currentMinutes,
    start,
    end,
    total,
    elapsed: boundedElapsed,
    remaining: total - boundedElapsed,
    progress,
    phase: elapsed < 0 ? "before" : progress >= 100 ? "after" : "active",
  } as const
}

function DayProgress() {
  const [schedule, setSchedule] = useState<DaySchedule>(readDaySchedule)
  const [draftSchedule, setDraftSchedule] = useState<DaySchedule>(schedule)
  const [cycleSettings, setCycleSettings] = useState<FocusCycleSettings>(
    readFocusCycleSettings,
  )
  const [draftCycleSettings, setDraftCycleSettings] =
    useState<FocusCycleSettings>(cycleSettings)
  const [now, setNow] = useState(() => new Date())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cycleSettingsOpen, setCycleSettingsOpen] = useState(false)
  const [scheduleError, setScheduleError] = useState("")
  const [cycleError, setCycleError] = useState("")
  const [cycleMessage, setCycleMessage] = useState("")
  const [scheduleSaved, setScheduleSaved] = useState(false)
  const progress = useMemo(() => getDayProgress(schedule, now), [schedule, now])
  const remainingPercentage = Math.max(0, Math.round(100 - progress.progress))
  const isScheduleActive = useCallback(
    () => getDayProgress(schedule, new Date()).phase === "active",
    [schedule],
  )
  const isScheduleClosed = useCallback(
    () => getDayProgress(schedule, new Date()).phase === "after",
    [schedule],
  )
  const handlePhaseTransition = useCallback(() => {
    playPhaseTransitionSound()
  }, [])
  const cycle = useFocusCycle({
    focusMinutes: cycleSettings.focusMinutes,
    breakMinutes: cycleSettings.breakMinutes,
    isScheduleActive,
    isScheduleClosed,
    onPhaseTransition: handlePhaseTransition,
  })
  const cyclePhaseLabel = cycle.phase === "focus" ? "Concentración" : "Descanso"
  const cycleDurationSeconds =
    (cycle.phase === "focus"
      ? cycleSettings.focusMinutes
      : cycleSettings.breakMinutes) * 60
  const cycleProgress = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((cycleDurationSeconds - cycle.remainingSeconds) /
          cycleDurationSeconds) *
          100,
      ),
    ),
  )

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  function handleScheduleToggle() {
    setSettingsOpen((open) => !open)
    setDraftSchedule(schedule)
    setScheduleError("")
    setScheduleSaved(false)
  }

  function handleScheduleSave() {
    if (!isValidTime(draftSchedule.start) || !isValidTime(draftSchedule.end)) {
      setScheduleError("Elige una hora de inicio y una hora de fin.")
      return
    }

    if (draftSchedule.start === draftSchedule.end) {
      setScheduleError("El inicio y el fin deben ser diferentes.")
      return
    }

    setSchedule(draftSchedule)
    let storageError = false
    try {
      localStorage.setItem(DAY_SCHEDULE_STORAGE, JSON.stringify(draftSchedule))
    } catch {
      storageError = true
    }
    setScheduleError(
      storageError ? "Se aplicó el horario, pero no se pudo guardar." : "",
    )
    setScheduleSaved(!storageError)
    window.setTimeout(() => setScheduleSaved(false), 2500)
  }

  function handleCycleSettingsToggle() {
    setCycleSettingsOpen((open) => !open)
    setDraftCycleSettings(cycleSettings)
    setCycleError("")
  }

  function handleCycleSettingsSave() {
    if (
      !isValidCycleDuration(draftCycleSettings.focusMinutes) ||
      !isValidCycleDuration(draftCycleSettings.breakMinutes)
    ) {
      setCycleError("Usa duraciones enteras entre 1 y 240 minutos.")
      return
    }

    setCycleSettings(draftCycleSettings)
    cycle.reset(draftCycleSettings.focusMinutes)
    try {
      localStorage.setItem(
        FOCUS_CYCLE_STORAGE,
        JSON.stringify(draftCycleSettings),
      )
      setCycleError("")
      setCycleSettingsOpen(false)
    } catch {
      setCycleError("Se aplicó el ciclo, pero no se pudo guardar.")
    }
  }

  function handleCycleStart() {
    if (cycle.start()) {
      preparePhaseTransitionSound()
      setCycleMessage("")
      return
    }

    setCycleMessage("El ciclo solo puede iniciar durante la jornada activa.")
  }

  function handleCycleResume() {
    if (cycle.resume()) {
      preparePhaseTransitionSound()
      setCycleMessage("")
      return
    }

    setCycleMessage("No puedes reanudar el ciclo fuera de la jornada activa.")
  }

  const headline =
    progress.phase === "before"
      ? `En ${formatDuration(progress.start - progress.currentMinutes)}`
      : progress.phase === "after"
        ? "Jornada cerrada"
        : `${Math.round(progress.progress)}%`
  const subline =
    progress.phase === "before"
      ? "para comenzar tu jornada"
      : progress.phase === "after"
        ? `Terminó a las ${formatTimeLabel(schedule.end)}`
        : `de tu jornada · quedan ${formatDuration(progress.remaining)}`

  return (
    <section className="pb-4" aria-label="Progreso del día">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold tracking-[-0.02em]">
            <Clock3 className="h-4 w-4 text-link" />
            Tiempo de hoy
          </h2>
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-heading text-3xl font-semibold tracking-[-0.035em] md:text-4xl">
              {headline}
            </p>
            <p className="border-l border-border pl-3 font-numeric text-sm font-medium text-link">
              {remainingPercentage}% restante
            </p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{subline}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">Ahora</p>
          <p className="mt-1 font-numeric text-sm font-medium text-foreground">
            {formatCurrentTime(now)}
          </p>
        </div>
      </div>

      <div className="mt-8" role="group" aria-label="Horario de la jornada">
        <div
          className="relative h-2 rounded-full bg-secondary"
          role="progressbar"
          aria-label="Progreso de la jornada"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.progress)}
          aria-valuetext={`${Math.round(progress.progress)}% consumido, ${remainingPercentage}% restante, quedan ${formatDuration(progress.remaining)}`}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--link))] transition-all duration-500"
            style={{ width: `${progress.progress}%` }}
          />
          <span
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-[0_0_0_4px_hsl(var(--link)/0.14),0_2px_8px_rgba(0,0,0,0.35)] transition-all duration-500"
            style={{ left: `${progress.progress}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between font-numeric text-xs text-muted-foreground">
          <span>{formatTimeLabel(schedule.start)}</span>
          <span>{formatTimeLabel(schedule.end)}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 border-t border-border pt-4 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="font-numeric text-base font-medium text-foreground">
            {formatDuration(progress.elapsed)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">transcurrido</p>
        </div>
        <div className="min-w-0 border-l border-border pl-4">
          <p className="font-numeric text-base font-medium text-foreground">
            {formatDuration(progress.remaining)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">restante</p>
        </div>
        <div className="col-span-2 mt-4 min-w-0 border-t border-border pt-4 sm:col-span-1 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <p className="font-numeric text-base font-medium text-foreground">
            {formatDuration(progress.total)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">presupuesto</p>
        </div>
      </div>

      <div className="mt-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleScheduleToggle}
          aria-expanded={settingsOpen}
          aria-controls="day-schedule-settings"
          className="-ml-3 text-muted-foreground"
        >
          Ajustar horario
          <ChevronDown
            className={`h-4 w-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`}
          />
        </Button>

        {settingsOpen && (
          <div
            id="day-schedule-settings"
            className="mt-3 space-y-4 border-t border-border pt-4 animate-fade-in"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="day-start">Inicio</Label>
                <Input
                  id="day-start"
                  type="time"
                  value={draftSchedule.start}
                  onChange={(event) =>
                    setDraftSchedule((current) => ({
                      ...current,
                      start: event.target.value,
                    }))
                  }
                  className="bg-secondary font-numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="day-end">Fin</Label>
                <Input
                  id="day-end"
                  type="time"
                  value={draftSchedule.end}
                  onChange={(event) =>
                    setDraftSchedule((current) => ({
                      ...current,
                      end: event.target.value,
                    }))
                  }
                  className="bg-secondary font-numeric"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" onClick={handleScheduleSave}>
                <Save data-icon="inline-start" />
                Guardar horario
              </Button>
              {scheduleSaved && (
                <span className="flex items-center gap-1.5 text-xs text-link animate-fade-in">
                  <Check className="h-3.5 w-3.5" /> Horario guardado
                </span>
              )}
              {scheduleError && (
                <p className="basis-full text-xs text-destructive">
                  {scheduleError}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <section
        className="mt-10 border-t border-border pt-7"
        aria-labelledby="focus-cycle-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <h2
              id="focus-cycle-heading"
              className="font-heading text-lg font-semibold tracking-[-0.02em]"
            >
              Ciclo de enfoque
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Alterna concentración y descanso dentro de tu jornada.
            </p>
          </div>
          <p className="rounded-md border border-border bg-secondary px-3 py-2 font-numeric text-xs font-medium text-muted-foreground">
            {cycleSettings.focusMinutes} min / {cycleSettings.breakMinutes} min
          </p>
        </div>

        <div className="mt-7 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-sm font-medium text-link">{cyclePhaseLabel}</p>
            <p className="mt-1 font-numeric text-4xl font-medium tracking-[-0.035em]">
              {formatTime(cycle.remainingSeconds)}
            </p>
            <p
              className="mt-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {cycle.status === "running" && `${cyclePhaseLabel} en curso.`}
              {cycle.status === "paused" &&
                `Pausado en ${cyclePhaseLabel.toLowerCase()}.`}
              {cycle.status === "idle" &&
                "Presiona iniciar cuando comience tu jornada."}
              {cycle.status === "complete" &&
                "La jornada terminó al completar la fase actual."}
            </p>
          </div>
          <div
            className="relative h-2 overflow-hidden rounded-full bg-secondary sm:w-40"
            role="progressbar"
            aria-label={`Progreso de ${cyclePhaseLabel.toLowerCase()}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={cycleProgress}
            aria-valuetext={`${cycleProgress}% completado, ${formatTime(cycle.remainingSeconds)} restantes`}
          >
            <div
              className="h-full rounded-full bg-[hsl(var(--link))] transition-[width] duration-300"
              style={{ width: `${cycleProgress}%` }}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {(cycle.status === "idle" || cycle.status === "complete") && (
            <Button type="button" onClick={handleCycleStart}>
              Iniciar
            </Button>
          )}
          {cycle.status === "running" && (
            <Button type="button" variant="secondary" onClick={cycle.pause}>
              Pausar
            </Button>
          )}
          {cycle.status === "paused" && (
            <Button type="button" onClick={handleCycleResume}>
              Reanudar
            </Button>
          )}
          {(cycle.status === "running" || cycle.status === "paused") && (
            <Button type="button" variant="ghost" onClick={() => cycle.reset()}>
              <Square data-icon="inline-start" />
              Detener y reiniciar
            </Button>
          )}
          {cycleMessage && (
            <p className="basis-full text-xs text-destructive" role="status">
              {cycleMessage}
            </p>
          )}
        </div>

        <div className="mt-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCycleSettingsToggle}
            aria-expanded={cycleSettingsOpen}
            aria-controls="focus-cycle-settings"
            disabled={cycle.status === "running" || cycle.status === "paused"}
            className="-ml-3 text-muted-foreground"
          >
            Ajustar ciclo
            <ChevronDown
              className={`h-4 w-4 transition-transform ${cycleSettingsOpen ? "rotate-180" : ""}`}
            />
          </Button>

          {cycleSettingsOpen && (
            <div
              id="focus-cycle-settings"
              className="mt-3 space-y-4 border-t border-border pt-4 animate-fade-in"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="focus-minutes">Concentración</Label>
                  <Input
                    id="focus-minutes"
                    type="number"
                    min="1"
                    max="240"
                    step="1"
                    inputMode="numeric"
                    value={draftCycleSettings.focusMinutes}
                    onChange={(event) =>
                      setDraftCycleSettings((current) => ({
                        ...current,
                        focusMinutes: Number(event.target.value),
                      }))
                    }
                    aria-describedby="focus-cycle-duration-hint"
                    className="bg-secondary font-numeric"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="break-minutes">Descanso</Label>
                  <Input
                    id="break-minutes"
                    type="number"
                    min="1"
                    max="240"
                    step="1"
                    inputMode="numeric"
                    value={draftCycleSettings.breakMinutes}
                    onChange={(event) =>
                      setDraftCycleSettings((current) => ({
                        ...current,
                        breakMinutes: Number(event.target.value),
                      }))
                    }
                    aria-describedby="focus-cycle-duration-hint"
                    className="bg-secondary font-numeric"
                  />
                </div>
              </div>
              <p
                id="focus-cycle-duration-hint"
                className="text-xs text-muted-foreground"
              >
                Elige duraciones enteras entre 1 y 240 minutos.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCycleSettingsSave}
                >
                  <Save data-icon="inline-start" />
                  Guardar ciclo
                </Button>
                {cycleError && (
                  <p className="basis-full text-xs text-destructive">
                    {cycleError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </section>
  )
}

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("dictation")
  const [model, setModel] = useState<FileTranscribeModel>(() => {
    const saved = localStorage.getItem(MODEL_STORAGE)
    return isFileTranscribeModel(saved) ? saved : "gpt-transcribe"
  })
  const [prompt, setPrompt] = useState("")
  const [languages, setLanguages] = useState("")
  const [keywords, setKeywords] = useState("")
  const [translateToEnglish, setTranslateToEnglish] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const recorder = useAudioRecorder()
  const isRecording = recorder.status === "recording"
  const selectedModel = getTranscribeModel(model)

  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE, model)
  }, [model])

  const ringScale = useMemo(() => 1 + recorder.level * 0.35, [recorder.level])

  async function handleToggleRecording() {
    setApiError(null)
    if (isRecording) {
      const blob = await recorder.stop()
      if (!blob) return
      setIsTranscribing(true)
      try {
        const text = await transcribeAudio(blob, {
          model,
          prompt,
          languages: csvValues(languages),
          keywords: csvValues(keywords),
          translateToEnglish,
        })
        if (text) setTranscript(text)
      } catch (error) {
        setApiError(
          error instanceof Error
            ? error.message
            : "Ocurrió un error al transcribir.",
        )
      } finally {
        setIsTranscribing(false)
      }
    } else {
      await recorder.start()
    }
  }

  async function handleCancelRecording() {
    setApiError(null)
    await recorder.cancel()
  }

  async function handleCopy() {
    if (!transcript) return
    await navigator.clipboard.writeText(transcript)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const busy = isTranscribing || recorder.status === "stopping"
  const operationLabel = translateToEnglish
    ? "Traduciendo al inglés…"
    : "Transcribiendo…"

  function handleSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return

    event.preventDefault()
    const currentIndex = SECTION_ORDER.indexOf(activeSection)
    const direction = event.key === "ArrowRight" ? 1 : -1
    const nextIndex =
      (currentIndex + direction + SECTION_ORDER.length) % SECTION_ORDER.length
    const nextSection = SECTION_ORDER[nextIndex]

    setActiveSection(nextSection)
    window.requestAnimationFrame(() => {
      document.getElementById(`section-tab-${nextSection}`)?.focus()
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-3xl py-10 md:py-16">
        <header className="mb-7 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] md:text-4xl">
              Dictless
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Convierte grabaciones en texto con modelos de transcripción de
              OpenAI.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setActiveSection("dictation")
              setSettingsOpen((open) =>
                activeSection === "dictation" ? !open : true,
              )
            }}
            aria-label="Ajustes de dictado"
            aria-expanded={settingsOpen && activeSection === "dictation"}
            aria-controls="dictation-settings"
            className="shrink-0"
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </header>

        <div
          className="mb-8 flex border-b border-border"
          role="tablist"
          aria-label="Secciones de Dictless"
        >
          <button
            id="section-tab-dictation"
            type="button"
            role="tab"
            aria-selected={activeSection === "dictation"}
            aria-controls="section-panel-dictation"
            tabIndex={activeSection === "dictation" ? 0 : -1}
            onClick={() => setActiveSection("dictation")}
            onKeyDown={handleSectionKeyDown}
            className={`-mb-px flex min-h-11 flex-1 items-center justify-center gap-2 border-b-2 px-2 pb-3 pt-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-none sm:px-5 ${
              activeSection === "dictation"
                ? "border-[hsl(var(--link))] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mic className="h-4 w-4" />
            Dictado
          </button>
          <button
            id="section-tab-time"
            type="button"
            role="tab"
            aria-selected={activeSection === "time"}
            aria-controls="section-panel-time"
            tabIndex={activeSection === "time" ? 0 : -1}
            onClick={() => setActiveSection("time")}
            onKeyDown={handleSectionKeyDown}
            className={`-mb-px flex min-h-11 flex-1 items-center justify-center gap-2 border-b-2 px-2 pb-3 pt-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-none sm:px-5 ${
              activeSection === "time"
                ? "border-[hsl(var(--link))] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock3 className="h-4 w-4" />
            Presupuesto de tiempo
          </button>
        </div>

        {activeSection === "time" ? (
          <div
            id="section-panel-time"
            role="tabpanel"
            aria-labelledby="section-tab-time"
            className="animate-fade-in"
          >
            <DayProgress />
          </div>
        ) : (
          <div
            id="section-panel-dictation"
            role="tabpanel"
            aria-labelledby="section-tab-dictation"
            className="animate-fade-in"
          >
            {settingsOpen && (
              <Card
                id="dictation-settings"
                className="mb-8 bg-card shadow-none"
              >
                <CardContent className="space-y-6 pt-6">
                  <div className="space-y-2">
                    <Label htmlFor="model">Modelo</Label>
                    <select
                      id="model"
                      value={model}
                      disabled={busy || isRecording}
                      onChange={(event) => {
                        const nextModel = event.target
                          .value as FileTranscribeModel
                        setModel(nextModel)
                        if (!getTranscribeModel(nextModel).supportsTranslation)
                          setTranslateToEnglish(false)
                      }}
                      className="flex h-11 w-full rounded-md border border-input bg-secondary px-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {TRANSCRIBE_MODELS.map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.label}
                        </option>
                      ))}
                    </select>
                    <div className="rounded-md border border-border bg-secondary px-3 py-3">
                      <p className="text-sm font-medium">
                        {selectedModel.description}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {selectedModel.capabilities.join(" · ")}
                      </p>
                    </div>
                  </div>

                  {selectedModel.supportsContext && (
                    <div className="space-y-2">
                      <Label htmlFor="prompt">
                        Contexto{" "}
                        <span className="font-normal text-muted-foreground">
                          (opcional)
                        </span>
                      </Label>
                      <Input
                        id="prompt"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="Ej.: reunión sobre el proyecto Atlas y la cuenta AC-42"
                        className="bg-secondary"
                      />
                      <div className="flex flex-wrap gap-2 pt-1">
                        {CONTEXT_PRESETS.map((preset) => (
                          <Button
                            key={preset.label}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPrompt(preset.value)}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedModel.supportsLanguageHints && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="languages">
                          Idiomas esperados{" "}
                          <span className="font-normal text-muted-foreground">
                            (opcional)
                          </span>
                        </Label>
                        <Input
                          id="languages"
                          value={languages}
                          onChange={(event) => setLanguages(event.target.value)}
                          placeholder="es, en"
                          className="bg-secondary"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="keywords">
                          Palabras clave{" "}
                          <span className="font-normal text-muted-foreground">
                            (opcional)
                          </span>
                        </Label>
                        <Input
                          id="keywords"
                          value={keywords}
                          onChange={(event) => setKeywords(event.target.value)}
                          placeholder="Atlas, AC-42"
                          className="bg-secondary"
                        />
                      </div>
                    </div>
                  )}

                  {selectedModel.supportsTranslation && (
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-secondary p-3">
                      <input
                        type="checkbox"
                        checked={translateToEnglish}
                        onChange={(event) =>
                          setTranslateToEnglish(event.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 accent-[hsl(var(--link))]"
                      />
                      <span>
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Languages className="h-4 w-4 text-link" /> Traducir
                          al inglés
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          Whisper es el único modelo de esta lista que admite
                          esta operación.
                        </span>
                      </span>
                    </label>
                  )}
                </CardContent>
              </Card>
            )}

            <section
              className="flex flex-col items-center gap-4 border-b border-border py-10 md:py-12"
              aria-label="Grabación"
            >
              <div className="relative flex h-32 w-32 items-center justify-center">
                {isRecording && (
                  <span
                    className="absolute inset-0 rounded-full bg-foreground/10 animate-pulse-ring"
                    style={{ transform: `scale(${ringScale})` }}
                  />
                )}
                <button
                  type="button"
                  onClick={handleToggleRecording}
                  disabled={busy}
                  className={`relative flex h-20 w-20 items-center justify-center rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    isRecording
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : "border-foreground bg-foreground text-background hover:scale-[1.03]"
                  }`}
                  style={
                    isRecording
                      ? { transform: `scale(${ringScale})` }
                      : undefined
                  }
                  aria-label={
                    isRecording
                      ? "Detener y transcribir grabación"
                      : "Empezar a grabar"
                  }
                >
                  {busy ? (
                    <Loader2 className="h-7 w-7 animate-spin" />
                  ) : isRecording ? (
                    <Square className="h-6 w-6" />
                  ) : (
                    <Mic className="h-7 w-7" />
                  )}
                </button>
              </div>

              <div className="h-6 font-numeric text-sm text-muted-foreground">
                {isRecording
                  ? formatTime(recorder.seconds)
                  : isTranscribing
                    ? operationLabel
                    : "Listo para grabar"}
              </div>

              {isRecording && (
                <div className="flex flex-col items-center gap-2 animate-fade-in">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelRecording}
                    disabled={busy}
                  >
                    <X data-icon="inline-start" />
                    Cancelar y descartar
                  </Button>
                </div>
              )}

              {(recorder.error || apiError) && (
                <p className="max-w-md text-center text-sm leading-6 text-destructive">
                  {recorder.error || apiError}
                </p>
              )}
            </section>

            <section className="pt-8" aria-label="Transcripción">
              <Card className="shadow-none">
                <CardContent className="pt-6">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div>
                      <Label
                        htmlFor="transcript"
                        className="font-medium text-foreground"
                      >
                        Transcripción
                      </Label>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTranscript("")}
                        disabled={!transcript}
                        aria-label="Limpiar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCopy}
                        disabled={!transcript}
                        aria-label="Copiar"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-link" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    id="transcript"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    placeholder="El texto transcrito aparecerá aquí. Puedes editarlo antes de copiarlo."
                    className="min-h-[240px] resize-y border-border bg-secondary text-[15px] leading-7"
                  />
                </CardContent>
              </Card>

              <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-link" />
                La transcripción generada puede tener errores. Verifica el texto
                antes de enviarlo.
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
