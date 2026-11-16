const paths: Record<string, string> = {
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  chart: "M4 20V10h4v10m4 0V4h4v16m4 0V8h2v12",
  activity: "m5 3 16 16-2 2L3 5V3h2Zm10 0h6v6m-6-1 6-5M3 21l6-6",
  members:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-3.87a4 4 0 0 1 0 7.75",
  user: "M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  treasury: "m3 9 9-6 9 6H3Zm2 3v6m5-6v6m4-6v6m5-6v6M3 21h18",
  payments: "M3 6h16v4M3 6v14h18V10H7a4 4 0 0 1-4-4Zm13 8h5",
  archive: "M3 3h18v5H3Zm2 5v13h14V8m-10 4h6",
  tool: "M8 3h8v18H8Zm2 4h4m-4 4h1m2 0h1m-4 4h1m2 0h1",
  admin: "m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7Zm-4 9 3 3 5-6",
  claims: "M5 3h14v18H5Zm4 5h6m-6 4h6m-6 4h3",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  moon: "M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  check: "m5 12 4 4L19 6",
  arrow: "M7 17 17 7M7 7h10v10",
  edit: "m16 3 5 5-12 12H4v-5L16 3Zm-3 3 5 5",
  menu: "M3 6h18M3 12h18M3 18h18",
};
export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.settings} />
    </svg>
  );
}
