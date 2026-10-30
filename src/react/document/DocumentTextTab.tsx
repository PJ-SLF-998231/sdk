import type { DocumentTextTabProps } from '../contracts';
import { ShelfRoot } from '../ShelfRoot';
import { CopyFeedback, TextPanel, useCopyNotice } from './TextPanel';

/** A document's full text with a Copy button. Takes the text; needs no session. */
export function DocumentTextTab({ text, theme, className }: DocumentTextTabProps) {
  const { notice, copyError, copy } = useCopyNotice();
  return (
    <ShelfRoot theme={theme} className={className}>
      <CopyFeedback notice={notice} copyError={copyError} />
      <TextPanel text={text} onCopy={(t) => void copy(t)} />
    </ShelfRoot>
  );
}
