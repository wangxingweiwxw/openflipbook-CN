"use client";

import type { ChangeEvent, FormEvent, RefObject } from "react";

import type { LocaleStrings } from "@/lib/i18n";

interface Props {
  t: LocaleStrings;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  busy: boolean;
  onClear: () => void;
  /** Seed upload is a home/root-only action — hide once you've drilled into a child page. */
  showUpload?: boolean;
}

/**
 * Top chrome on /play: query + upload + clear + go.
 * Locale / theme / image tier / speed / spend / world stay on their hooks in
 * page.tsx (defaults + localStorage) — just not in this bar.
 */
export function QueryToolbar({
  t,
  input,
  onInputChange,
  onSubmit,
  fileInputRef,
  onFileInputChange,
  busy,
  onClear,
  showUpload = true,
}: Props) {
  return (
    <>
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-center gap-2 rounded-full border border-[var(--color-edge)] bg-[var(--color-canvas)]/80 px-4 py-2 shadow-sm"
      >
        <input
          autoFocus
          className="min-w-[8rem] flex-1 bg-transparent outline-none placeholder:opacity-60"
          placeholder={t.placeholder}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
        />
        {showUpload ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="rounded-full border border-[var(--color-edge)] px-3 py-1 text-xs hover:bg-[var(--color-ink)]/5 disabled:opacity-40"
            title="Upload an image as the starting page. Tap on it to explore regions."
          >
            {t.upload}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClear}
          title="clear history"
          className="rounded-full bg-black px-3 py-1 text-xs font-medium text-white hover:bg-black/85"
        >
          clear
        </button>
        <button
          type="submit"
          disabled={busy || input.trim().length === 0}
          className="rounded-full bg-[var(--color-ink)] px-4 py-1 text-[var(--color-canvas)] disabled:opacity-40"
        >
          {busy ? t.generating : t.go}
        </button>
      </form>

      {showUpload ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileInputChange}
        />
      ) : null}
    </>
  );
}
