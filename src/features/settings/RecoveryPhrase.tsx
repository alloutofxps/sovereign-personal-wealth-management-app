/* ===========================================================================
 * A PHRASE INSTEAD OF A PASSWORD
 * ---------------------------------------------------------------------------
 * An encrypted export is only as good as the thing that opens it, and the
 * thing that opens it is usually the weakest part of the whole design: a
 * password invented in a hurry, used nowhere else, and needed for the first
 * time three years later on a different device.
 *
 * Twelve words solve that, and not because they are clever. They are written
 * down, on paper, in a drawer — which is the one place that survives the
 * phone, the laptop and the house move. The wordlist is chosen so no two words
 * share their first four letters, so a phrase copied out in a hurry can still
 * be read back; and the phrase carries a checksum, so one word wrong is
 * *refused* rather than quietly producing a key that decrypts nothing.
 *
 * The phrase is the passphrase. It is not stored, not remembered, and not put
 * in the export it protects — a recovery phrase saved on the device it guards
 * is a spare key taped to the door.
 * ======================================================================== */

import { useState } from 'react';
import { Button } from '@/design/ui';

export function RecoveryPhrase({
  value,
  onChange,
}: {
  /** The phrase, owned by the sheet above so it can be used as the passphrase. */
  value: string;
  onChange: (phrase: string) => void;
}) {
  const [made, setMade] = useState<{ number: number; word: string }[] | null>(null);
  /** The generated phrase, held back until it has been acknowledged. */
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [written, setWritten] = useState(false);

  async function make() {
    setBusy(true);
    setProblem(null);
    try {
      // Loaded here rather than imported at the top: the wordlist is two
      // thousand words, and nobody who is not looking at a recovery phrase
      // should pay for it.
      const { generateMnemonic, numberedWords } = await import('@/core/crypto/mnemonic');
      const phrase = await generateMnemonic(12);
      setMade(numberedWords(phrase));
      setWritten(false);
      setPending(phrase);
      // Deliberately not handed up yet. The sheet above uses whatever this
      // reports as the key to lock the file with, and a phrase that has not
      // been written down is a file nobody can open.
      onChange('');
    } catch {
      setProblem('A phrase could not be made just now. Nothing has changed.');
    } finally {
      setBusy(false);
    }
  }

  async function check(typed: string) {
    onChange(typed);
    if (typed.trim() === '') {
      setProblem(null);
      return;
    }
    const { checkMnemonic } = await import('@/core/crypto/mnemonic');
    const found = await checkMnemonic(typed);
    setProblem(found === null ? null : found.message);
  }

  if (made) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-2">
          Write these down, in this order, and keep the paper somewhere you would keep a
          passport. They are the only way back into the file.
        </p>

        <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-line bg-sunken px-3.5 py-3 sm:grid-cols-3">
          {made.map((item) => (
            <li key={item.number} className="flex items-baseline gap-2">
              <span className="tnum w-5 shrink-0 text-right text-micro text-ink-3">
                {item.number}
              </span>
              <span className="font-mono text-body text-ink">{item.word}</span>
            </li>
          ))}
        </ol>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={written}
            onChange={(event) => {
              setWritten(event.target.checked);
              // The tick is the whole gate. Untick it and the key goes away
              // again, so the copy below is a promise rather than a caption.
              onChange(event.target.checked ? pending : '');
            }}
            className="mt-0.5 size-4 accent-[var(--color-liquid)]"
          />
          <span className="text-caption text-ink-2">
            I have written them down. Sovereign has not kept a copy, and cannot.
          </span>
        </label>

        {!written && (
          <p className="text-caption text-ink-3">
            Nothing will be saved until that is ticked. Losing the phrase means losing the file.
          </p>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setMade(null);
            setPending('');
            setWritten(false);
            onChange('');
          }}
        >
          Use something else
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-2">
        <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
          A recovery phrase you already have
        </span>
        <textarea
          value={value}
          onChange={(event) => void check(event.target.value)}
          rows={2}
          placeholder="Twelve words, separated by spaces"
          className="w-full resize-none rounded-md border border-line bg-raised px-3.5 py-3 font-mono text-body text-ink placeholder:font-sans placeholder:text-ink-3"
        />
      </label>

      {problem && (
        <p className="text-caption text-caution" role="alert">
          {problem}
        </p>
      )}

      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void make()}>
        {busy ? 'Making one…' : 'Make me a new phrase'}
      </Button>
    </div>
  );
}

/** Whether a phrase is good enough to lock a file with. */
export async function phraseIsUsable(phrase: string): Promise<boolean> {
  if (phrase.trim() === '') return false;
  const { validateMnemonic } = await import('@/core/crypto/mnemonic');
  return validateMnemonic(phrase);
}
