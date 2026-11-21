/** Quote every cell; neutralize spreadsheet formulas, including leading whitespace. */
export function csv(rows: unknown[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s =
              value == null
                ? ""
                : Array.isArray(value)
                  ? value.join(", ")
                  : String(value);
            if (/^[\s\u0000-\u001f]*[=+@-]/u.test(s) || /^[\t\r\n]/.test(s))
              s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n") +
    "\r\n"
  );
}
