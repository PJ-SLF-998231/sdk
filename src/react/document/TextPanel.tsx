import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import { copyText } from './copy';

/** The Full text card, as the document page draws it. `onCopy` is given the text when Copy is pressed. */
export function TextPanel({ text, onCopy }: { text: string | null | undefined; onCopy(text: string): void }) {
  const has = Boolean(text);
  return (
    <div className={cx('doc-content')} role="tabpanel">
      <section className={cx('doc-panel', 'doc-text-panel')}>
        <div className={cx('doc-panel-head')}>
          <div>
            <h2 className={cx('kicker')}>Full text</h2>
          </div>
          {has && (
            <div className={cx('doc-panel-actions')}>
              <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={() => onCopy(text ?? '')}>
                Copy
              </button>
            </div>
          )}
        </div>
        {has ? <pre className={cx('doc-text')}>{text}</pre> : <p className={cx('status-note')}>The text appears here once Shelf has read the file.</p>}
      </section>
    </div>
  );
}

/** Copy feedback: the "Copied" notice and the failure alert the document page shows above its tabs. */
export function useCopyNotice(): { notice: string | null; copyError: string | null; copy(text: string): Promise<void> } {
  const [notice, setNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    const ok = await copyText(text);
    setNotice(ok ? 'Copied the text.' : null);
    setCopyError(ok ? null : "Your browser didn't allow copying. Select the text and copy it instead.");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  }, []);
  return { notice, copyError, copy };
}

/** The feedback useCopyNotice reports; the same markup the page draws. */
export function CopyFeedback({ notice, copyError }: { notice: string | null; copyError: string | null }) {
  return (
    <>
      <div aria-live="polite">{notice && <p className={cx('callout', 'notice')}>{notice}</p>}</div>
      {copyError && (
        <p className={cx('callout', 'callout--danger')} role="alert">
          {copyError}
        </p>
      )}
    </>
  );
}
