/* ===========================================================================
 * CONFIRMATIONS
 * ---------------------------------------------------------------------------
 * A short line after an action, saying what actually happened in words the
 * person would use themselves. Never "Transaction committed."
 * ======================================================================== */

import { create } from 'zustand';

export type ToastTone = 'done' | 'attention';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** Optional single action, e.g. undoing what just happened. */
  action?: { label: string; run: () => void };
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, options?: { tone?: ToastTone; action?: Toast['action'] }) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, options) => {
    const id = nextId++;
    const toast: Toast = {
      id,
      message,
      tone: options?.tone ?? 'done',
      ...(options?.action ? { action: options.action } : {}),
    };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Show a confirmation from outside React — event handlers, async callbacks. */
export const toast = (message: string, options?: Parameters<ToastStore['show']>[1]): number =>
  useToasts.getState().show(message, options);
