import React from 'react';
import { Home, Sparkles, Zap, Star, Heart, Flame, Leaf, type LucideIcon } from 'lucide-react';

/** Alternate icons a user can pick for the sidebar logo, keyed by id.
 *  'pulse' is the default heartbeat glyph and is drawn separately below
 *  (it isn't a lucide icon), so it isn't listed here. */
export const APP_ICON_ALTERNATES: Record<string, LucideIcon> = {
  home: Home,
  sparkles: Sparkles,
  zap: Zap,
  star: Star,
  heart: Heart,
  flame: Flame,
  leaf: Leaf,
};

/** Every selectable icon id, 'pulse' (the default) first. Shared by
 *  PulseLogo's own rendering and the icon picker in Settings. */
export const APP_ICON_IDS = ['pulse', ...Object.keys(APP_ICON_ALTERNATES)] as const;
export type AppIconId = (typeof APP_ICON_IDS)[number];

interface PulseLogoProps {
  size?: number;
  /** If true, render the full wordmark alongside the icon */
  wordmark?: boolean;
  /** Text shown next to the icon when `wordmark` is true. Defaults to "HAPulse". */
  name?: string;
  /** Which glyph to show. Falls back to 'pulse' for an unrecognised id. Defaults to 'pulse'. */
  icon?: string | undefined;
  /** If true, the icon is omitted entirely (wordmark only, when shown). */
  hideIcon?: boolean;
}

/**
 * HAPulse logomark — rounded square with a heartbeat/pulse line in accent color
 * by default, or a user-chosen lucide icon in the same square.
 */
export function PulseLogo({ size = 36, wordmark = false, name = 'HAPulse', icon = 'pulse', hideIcon = false }: PulseLogoProps) {
  const Alternate = APP_ICON_ALTERNATES[icon];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        flexShrink: 0,
      }}
    >
      {!hideIcon && (
        Alternate ? (
          <span
            style={{
              width: size,
              height: size,
              borderRadius: size * 0.25,
              background: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <Alternate size={size * 0.56} color="var(--on-accent)" strokeWidth={2.25} />
          </span>
        ) : (
          <svg
            width={size}
            height={size}
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Rounded square background */}
            <rect width="36" height="36" rx="9" fill="var(--accent)" />
            {/* Pulse / heartbeat line */}
            <polyline
              points="4,18 9,18 12,10 15,26 18,14 21,22 24,18 32,18"
              stroke="var(--on-accent)"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        )
      )}

      {wordmark && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '1.25rem',
            letterSpacing: '-0.02em',
            color: 'var(--text)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </span>
      )}
    </span>
  );
}
