// a11y helpers — keep the visual design (div-as-button) but make it keyboard-reachable.
// Without these, screen readers can't announce the element and Tab/Enter/Space don't fire it.
import type { KeyboardEvent } from 'react';

// Spread onto a non-button element that should behave as a button.
// Example: <div {...clickable(() => navigate('practice'))} className="quick">…</div>
export function clickable(onActivate: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
