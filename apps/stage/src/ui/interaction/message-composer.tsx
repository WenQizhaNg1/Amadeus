import { SendHorizontal, Square } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';

interface MessageComposerProps {
  disabled: boolean;
  pending: boolean;
  interruptible: boolean;
  onSubmit(text: string): boolean;
  onInterrupt(): void;
}

export function MessageComposer({
  disabled,
  pending,
  interruptible,
  onSubmit,
  onInterrupt,
}: MessageComposerProps) {
  const [text, setText] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (onSubmit(text)) {
      setText('');
    }
  }

  return (
    <form className="flex items-center gap-2" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="stage-message">
        发送给 AMADEUS 的消息
      </label>
      <Input
        id="stage-message"
        value={text}
        maxLength={32_768}
        autoComplete="off"
        placeholder={disabled ? '等待 Stage 就绪…' : '输入消息…'}
        disabled={disabled || pending}
        onChange={(event) => setText(event.target.value)}
        className="h-11 border-white/10 bg-black/20 px-4 backdrop-blur-sm focus-visible:border-primary/60"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!interruptible}
        onClick={onInterrupt}
        aria-label="打断当前响应"
        className="size-11 border-white/10 bg-black/20"
      >
        <Square className="size-3.5 fill-current" />
      </Button>
      <Button
        type="submit"
        size="icon"
        disabled={disabled || pending || text.trim().length === 0}
        aria-label="发送消息"
        className="size-11"
      >
        <SendHorizontal />
      </Button>
    </form>
  );
}
