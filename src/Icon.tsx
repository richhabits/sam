/**
 * SAM's icon set — one file, no dependency.
 *
 * Replaces the emoji that were doing icon duty across the UI. Emoji render as full-colour
 * clip-art that shifts between platforms, ignores the theme, and can't take the accent colour;
 * on a light theme they read as stickers. These are 24×24 stroke glyphs on `currentColor`, so
 * they inherit text colour, accent, opacity and every one of the nine themes for free.
 *
 * Drawn in SAM's own vocabulary rather than pulled from a library: a set this small (one path
 * or two per glyph) is not worth an npm dependency, and everything else here is ours.
 *
 * Conventions — 24×24 box, 1.75 stroke, round caps and joins, no fills. Keep them geometric
 * and boring; an icon that draws attention to itself is a failed icon.
 */

export type IconName =
  | "chat" | "voice" | "studio" | "briefcase" | "home" | "key" | "chart" | "settings"
  | "team" | "ninja" | "eye" | "people" | "markets" | "trophy" | "search" | "plus"
  | "pin" | "pencil" | "close" | "check" | "refresh" | "phone" | "brain" | "shield"
  | "book" | "sparkle" | "clock" | "download" | "folder" | "bell" | "lock" | "trash";

const P: Record<IconName, React.ReactNode> = {
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />,
  voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  studio: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m3 15 5-4 4 3 3-2 6 5" /><circle cx="9" cy="9" r="1.3" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" /></>,
  home: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" />,
  key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M15 12v2" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-2-5.2M21 20a5 5 0 0 0-4-4.9" /></>,
  ninja: <><path d="M3 12a9 9 0 0 1 18 0" /><rect x="3" y="11" width="18" height="5" rx="2.5" /><path d="M8 13.5h3M14 13.5h2" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  people: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  markets: <><path d="M3 17l5-5 3.5 3.5L21 6" /><path d="M15 6h6v6" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M7 6H4.5A2.5 2.5 0 0 0 7 10M17 6h2.5A2.5 2.5 0 0 1 17 10M9.5 20h5M12 14v6" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-3.5-3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  pin: <path d="M12 17v4M9 4h6l-1 6 3 3H7l3-3-1-6Z" />,
  pencil: <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4 16.5Z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 13 4.5 4.5L19 7" />,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4.5h-4.5" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  brain: <><path d="M9.5 5A3.5 3.5 0 0 0 6 8.5 3 3 0 0 0 5 14a3.2 3.2 0 0 0 3 4.8" /><path d="M14.5 5A3.5 3.5 0 0 1 18 8.5 3 3 0 0 1 19 14a3.2 3.2 0 0 1-3 4.8" /><path d="M12 4.5v15" /></>,
  shield: <path d="M12 3.5 5 6.5V12c0 4.4 3 7.6 7 8.5 4-.9 7-4.1 7-8.5V6.5Z" />,
  book: <><path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v13H7.5A2.5 2.5 0 0 1 5 17.5Z" /><path d="M17 7h2v13" /></>,
  sparkle: <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 20l-1.8-5.4L4.5 12.8 10.2 11Z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M4.5 19h15" />,
  folder: <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />,
  bell: <><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" /></>,
  trash: <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 13h9l1-13M10.5 11v5M13.5 11v5" />,
};

export default function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`ic${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  );
}
