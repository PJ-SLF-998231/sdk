/** Prefixes each class with `shelf-sdk__` so nothing here can collide with, or be styled by, the host page. */
export const cx = (...names: Array<string | false | null | undefined>): string =>
  names
    .filter((n): n is string => Boolean(n))
    .flatMap((n) => n.split(/\s+/))
    .map((n) => `shelf-sdk__${n}`)
    .join(' ');
