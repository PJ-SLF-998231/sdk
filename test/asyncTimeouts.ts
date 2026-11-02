/**
 * Shared upper bounds for asynchronous waits in the tests. They are ceilings, not delays: a wait returns as soon as
 * its condition holds, so a generous value costs nothing when the machine is idle and saves the run when it is not.
 */

/** Anything that waits on a lazily loaded chunk (DocumentPage, DocumentContent, the outbox, the virtual list). */
export const LAZY_TIMEOUT = 5000;

/** A wait that spans a real 2.5 s poll interval or several retry backoffs, with room to spare. */
export const POLL_TIMEOUT = 10_000;
