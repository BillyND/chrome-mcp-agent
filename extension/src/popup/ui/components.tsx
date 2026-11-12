// shadcn/ui components used by the popup (new-york style, trimmed to what it needs).

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Slot } from '@radix-ui/react-slot';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { segmentedClass, segmentedItemClass, segmentedItemSm } from '../../../../shared/ui-classes';
import { Icon } from './icons';
import { cn } from './utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'border bg-background text-destructive shadow-xs hover:bg-destructive/10',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-muted-foreground underline-offset-4 hover:underline hover:text-foreground h-auto px-0',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground px-3 py-2.5', className)} {...props} />;
}

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}


/** An outline icon button that opens a small menu of choices, like shadcn's Popover with a command list; the current choice is checked. */
export function MenuPopover<T extends string>({
  id,
  label,
  trigger,
  value,
  options,
  onSelect,
}: {
  id: string;
  label: string;
  trigger: ReactNode;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button id={id} variant="outline" size="icon" aria-label={label} title={label}>
          {trigger}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-40 rounded-md border bg-card p-1 text-card-foreground shadow-md outline-none origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-[pop-in_120ms_ease-out]"
        >
          <div role="menu" aria-label={label} className="flex flex-col">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={o.value === value}
                data-value={o.value}
                onClick={() => {
                  onSelect(o.value);
                  setOpen(false);
                }}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4"
              >
                {o.icon && <span className="text-muted-foreground">{o.icon}</span>}
                <span className="flex-1">{o.label}</span>
                {o.value === value && Icon.check}
              </button>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root className={cn(segmentedClass, className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(segmentedItemClass, segmentedItemSm, className)}
      {...props}
    />
  );
}

/**
 * A collapsible block like shadcn's Collapsible: the whole header row toggles it, a count or short value sits before the chevron.
 * The body stays mounted and slides open by animating its grid row; while closed it is inert, so nothing inside takes focus.
 */
export function Collapsible({ id, title, count, children }: { id: string; title: string; count?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={id} className="rounded-lg border bg-card text-card-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn('flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-[15px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', open ? 'rounded-t-lg' : 'rounded-lg')}
      >
        <span className="flex-1">{title}</span>
        {count !== undefined && <span className="text-[13px] font-normal text-muted-foreground">{count}</span>}
        <span className={cn('shrink-0 text-muted-foreground transition-transform duration-200 [&_svg]:size-4', open && 'rotate-180')}>{Icon.chevronDown}</span>
      </button>
      <div
        className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 border-t p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
