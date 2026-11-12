// Tailwind class strings shared by the extension's React components and the gateway's server-rendered pages,
// so both draw the same controls. Tailwind scans this file (see extension/src/popup/styles.css).

/** A segmented control (shadcn ToggleGroup): a muted track with the selected item raised. */
export const segmentedClass = 'inline-flex items-center rounded-md bg-muted p-0.5';
/** One item; add a size (`segmentedItemSm` or your own height, padding and text size). */
export const segmentedItemClass =
  'inline-flex cursor-pointer items-center justify-center rounded-sm font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs [&_svg]:size-3.5';
export const segmentedItemSm = 'h-6 min-w-7 px-1.5 text-[11px]';
