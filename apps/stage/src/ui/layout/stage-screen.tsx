import type { StageActivity } from '@amadeus/stage-protocol';
import {
  Activity,
  CircleAlert,
  Mic,
  MicOff,
  Power,
  Radio,
  Sparkles,
  X,
} from 'lucide-react';

import type { StageState } from '../../application/stage-state.ts';
import type { ConnectionStatus } from '../../transport/stage-transport.ts';
import { Alert, AlertDescription, AlertTitle } from '../components/alert.tsx';
import { Badge } from '../components/badge.tsx';
import { Button } from '../components/button.tsx';
import { MessageComposer } from '../interaction/message-composer.tsx';
import { cn } from '../lib/cn.ts';

interface StageScreenProps {
  state: StageState;
  transportLabel: string;
  start(): void;
  submitText(text: string): boolean;
  interrupt(): void;
  dismissError(): void;
}

const connectionPresentation: Record<
  ConnectionStatus,
  { label: string; dot: string }
> = {
  disconnected: { label: '未连接', dot: 'bg-muted-foreground' },
  connecting: { label: '连接中', dot: 'bg-amber-400' },
  'awaiting-state': { label: '同步状态', dot: 'bg-amber-400' },
  ready: { label: '已连接', dot: 'bg-emerald-400' },
  reconnecting: { label: '重新连接', dot: 'bg-amber-400' },
};

const activityPresentation: Record<
  StageActivity,
  { label: string; accent: string }
> = {
  idle: { label: '待机', accent: 'text-muted-foreground' },
  listening: { label: '聆听', accent: 'text-sky-300' },
  thinking: { label: '思考', accent: 'text-violet-300' },
  speaking: { label: '表达', accent: 'text-primary' },
};

const microphoneLabel = {
  inactive: '麦克风未启用',
  requesting: '请求麦克风',
  listening: '正在聆听',
  blocked: '麦克风不可用',
} as const;

export function StageScreen({
  state,
  transportLabel,
  start,
  submitText,
  interrupt,
  dismissError,
}: StageScreenProps) {
  const connection = connectionPresentation[state.connection];
  const activity = activityPresentation[state.activity];
  const busy = state.activity === 'thinking' || state.activity === 'speaking';

  return (
    <div className="relative min-h-svh overflow-x-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_28%,oklch(0.58_0.15_255_/_0.18),transparent_34%),linear-gradient(to_bottom,transparent_55%,oklch(0.1_0.015_260_/_0.95))]"
      />
      <div
        aria-hidden="true"
        className="stage-grid pointer-events-none fixed inset-0 opacity-35"
      />

      <main className="relative mx-auto flex min-h-svh w-full max-w-[1600px] flex-col gap-4 p-4 sm:p-6 lg:p-8">
        <header className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-black/15 px-4 py-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[0.24em]">
                AMADEUS
              </p>
              <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                Local Stage / Preview
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-white/10 bg-black/20">
              <span
                className={cn('size-1.5 rounded-full', connection.dot)}
                aria-hidden="true"
              />
              {connection.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn('hidden border-white/10 bg-black/20 sm:flex', activity.accent)}
            >
              <Activity />
              {activity.label}
            </Badge>
          </div>
        </header>

        <section
          aria-label="Live2D 舞台占位区域"
          className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/8 bg-card/25 shadow-2xl shadow-black/20 backdrop-blur-sm"
        >
          <div className="absolute inset-x-5 top-5 flex items-center justify-between text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            <span>Model channel</span>
            <span>Live2D pending</span>
          </div>

          <div
            aria-hidden="true"
            className={cn(
              'absolute size-[min(62vw,52vh)] max-h-[580px] max-w-[580px] rounded-full border border-primary/15 bg-primary/[0.025] shadow-[0_0_120px_oklch(0.62_0.17_255_/_0.08)] transition-all duration-700',
              busy && 'scale-105 border-primary/30 bg-primary/[0.045]',
            )}
          >
            <div className="absolute inset-[12%] rounded-full border border-dashed border-white/10" />
            <div className="absolute inset-[28%] rounded-full border border-primary/15" />
            <div className="absolute inset-1/2 size-1 -translate-1/2 rounded-full bg-primary shadow-[0_0_30px_oklch(0.72_0.16_250)]" />
          </div>

          <div className="relative flex flex-col items-center gap-3 text-center">
            <Radio
              className={cn(
                'size-7 text-muted-foreground transition-colors duration-500',
                activity.accent,
              )}
            />
            <div>
              <p className="text-xs tracking-[0.3em] text-muted-foreground uppercase">
                Runtime state
              </p>
              <p className={cn('mt-2 text-2xl font-light', activity.accent)}>
                {activity.label}
              </p>
            </div>
          </div>

          <div
            aria-live="polite"
            className="absolute inset-x-6 bottom-7 mx-auto max-w-3xl text-center sm:bottom-10"
          >
            <p className="min-h-8 text-balance text-lg leading-relaxed font-medium text-foreground/95 drop-shadow-lg sm:text-xl">
              {state.subtitle ?? ''}
            </p>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-white/8 bg-black/15 p-3 backdrop-blur-xl sm:p-4">
          <div className="flex min-h-5 items-center justify-between gap-4 px-1 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  state.transcript?.final ? 'bg-emerald-400' : 'bg-muted-foreground',
                )}
              />
              <span className="truncate">
                {state.transcript?.text ?? '等待语音输入'}
              </span>
            </div>
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              {state.microphone === 'listening' ? (
                <Mic className="size-3.5" />
              ) : (
                <MicOff className="size-3.5" />
              )}
              {microphoneLabel[state.microphone]}
            </div>
          </div>

          {state.error && (
            <Alert variant="destructive" className="pr-12">
              <CircleAlert />
              <AlertTitle>{state.error.code}</AlertTitle>
              <AlertDescription>{state.error.message}</AlertDescription>
              {state.error.recoverable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-1.5 right-1.5 size-8"
                  onClick={dismissError}
                  aria-label="关闭错误提示"
                >
                  <X />
                </Button>
              )}
            </Alert>
          )}

          <MessageComposer
            disabled={state.connection !== 'ready'}
            pending={state.pendingRequestId !== undefined}
            interruptible={state.connection === 'ready' && busy}
            onSubmit={submitText}
            onInterrupt={interrupt}
          />
        </section>
      </main>

      {!state.interactionStarted && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-background/72 p-6 backdrop-blur-xl">
          <section className="w-full max-w-md rounded-2xl border border-white/10 bg-card/80 p-7 text-center shadow-2xl shadow-black/40">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <Power className="size-6" />
            </div>
            <p className="mt-6 text-xs tracking-[0.3em] text-primary uppercase">
              AMADEUS Stage
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              准备开始交互
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              启动本地舞台并建立预览连接。音频权限会在语音能力接入后由这里统一申请。
            </p>
            {state.error && (
              <p className="mt-4 text-sm text-destructive">
                {state.error.message}
              </p>
            )}
            <Button type="button" size="lg" className="mt-7 w-full" onClick={start}>
              <Power />
              开始交互
            </Button>
            <p className="mt-4 text-[11px] tracking-wide text-muted-foreground">
              {transportLabel}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
