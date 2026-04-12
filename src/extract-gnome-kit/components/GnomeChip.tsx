"use client";

// ─────────────────────────────────────────────
// GnomeChip — the atomic unit inside a quarter row.
//
// One chip represents "gnome X has N tasks in this day+quarter". The count
// badge only appears when N > 1. The recurring badge prop is wired for
// Phase 2; when `isRecurring` is false (Phase 1 default) it's hidden so the
// component is a pure drop-in when ScheduledTaskEntry/TaskRecurrence land.
//
// Icon handling matches the rest of the app (see ProjectDetailView): when
// `gnome.icon` starts with "/" it's a PNG path under /public and rendered
// as an <img>; otherwise it's treated as an emoji/text glyph. If neither
// is available we fall back to two-letter initials so the chip is never
// empty.
// ─────────────────────────────────────────────

import type { GnomeRef, TaskRef } from "@/types/time-strip";

interface GnomeChipProps {
  gnome: GnomeRef;
  tasks: TaskRef[];
  /**
   * When true, renders a small ↻ badge on the chip. Phase 1 always passes
   * false. The prop exists so Phase 2 can enable it without touching any
   * component code — just flip the bit in the spec-builder.
   */
  isRecurring?: boolean;
  /** Dims the chip when its day is in the past (drawn by DayBox). */
  isPast?: boolean;
  onClick?: (gnome: GnomeRef, tasks: TaskRef[]) => void;
}

export function GnomeChip({
  gnome,
  tasks,
  isRecurring = false,
  isPast = false,
  onClick,
}: GnomeChipProps) {
  const count = tasks.length;
  // If any task in the group is a scheduled delivery we flag the chip
  // so the user can tell deliveries apart from normal task executions.
  const deliveryTask = tasks.find((t) => t.kind === "delivery");
  const hasDelivery = deliveryTask !== undefined;
  const deliveryLabel = deliveryTask?.workProductLabel;
  const deliveryTime = deliveryTask?.scheduledForUtc
    ? formatScheduledTime(deliveryTask.scheduledForUtc)
    : null;
  const baseTooltip =
    count === 1
      ? `${gnome.name} — ${tasks[0].title}`
      : `${gnome.name} — ${count} tasks:\n${tasks.map((t) => `• ${t.title}`).join("\n")}`;
  const tooltip = hasDelivery
    ? `${baseTooltip}\n\nDelivery${deliveryLabel ? `: ${deliveryLabel}` : ""}${deliveryTime ? `\nScheduled: ${deliveryTime}` : ""}`
    : baseTooltip;

  // Icon can be (a) a path to a PNG under /public (starts with "/"),
  // (b) an emoji or single glyph, or (c) null/empty. We normalize empty
  // strings to null so `??` falls through to initials correctly.
  const iconValue = gnome.icon && gnome.icon.length > 0 ? gnome.icon : null;
  const isImagePath = iconValue !== null && iconValue.startsWith("/");

  return (
    <button
      type="button"
      title={tooltip}
      onClick={() => onClick?.(gnome, tasks)}
      className={[
        "relative inline-flex items-center justify-center",
        "h-7 w-7 rounded-full overflow-hidden",
        "bg-white/80 dark:bg-neutral-800/80",
        "border border-neutral-300 dark:border-neutral-600",
        "shadow-sm hover:shadow-md transition-all",
        "text-base leading-none select-none",
        isPast ? "opacity-80 grayscale-[0.3]" : "",
      ].join(" ")}
      aria-label={`${gnome.name}: ${count} task${count === 1 ? "" : "s"}`}
    >
      {isImagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconValue!}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : iconValue !== null ? (
        <span aria-hidden>{iconValue}</span>
      ) : (
        <span className="text-[10px] font-semibold">{initials(gnome.name)}</span>
      )}

      {/* Count badge — only when more than one task shares this chip */}
      {count > 1 && (
        <span
          className={[
            "absolute -top-1 -right-1",
            "min-w-[16px] h-[16px] px-1",
            "rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
            "text-[10px] font-semibold leading-[16px] text-center",
            "border border-white dark:border-neutral-900",
          ].join(" ")}
        >
          {count}
        </span>
      )}

      {/* Delivery indicator — Phase 2b.1. Sits in the top-left corner so
          it coexists with the count (top-right) and recurring (bottom-right)
          badges without overlapping. */}
      {hasDelivery && (
        <span
          className={[
            "absolute -top-1 -left-1",
            "w-[14px] h-[14px]",
            "rounded-full bg-amber-500 text-white",
            "text-[9px] leading-[14px] text-center",
            "border border-white dark:border-neutral-900",
          ].join(" ")}
          aria-label="Scheduled delivery"
          title="Scheduled delivery"
        >
          ↗
        </span>
      )}

      {/* Recurring indicator — Phase 2, hidden when false */}
      {isRecurring && (
        <span
          className={[
            "absolute -bottom-1 -right-1",
            "w-[14px] h-[14px]",
            "rounded-full bg-sky-500 text-white",
            "text-[10px] leading-[14px] text-center",
            "border border-white dark:border-neutral-900",
          ].join(" ")}
          aria-label="Recurring"
        >
          ↻
        </span>
      )}
    </button>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

// Format a UTC ISO instant in the viewer's local timezone for the native
// title tooltip. Kept short so the hover stays scannable — weekday, date,
// and local time (e.g. "Mon Apr 6, 9:00 AM").
function formatScheduledTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
