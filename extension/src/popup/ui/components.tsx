// shadcn/ui components used by the popup (new-york style, trimmed to what it needs).

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Slot } from '@radix-ui/react-slot';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { useState, type ComponentProps, type ReactNode } from 'react';
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

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

export function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root className={cn('inline-flex items-center rounded-md bg-muted p-0.5', className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'inline-flex h-6 min-w-7 cursor-pointer items-center justify-center rounded-sm px-1.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

/** A collapsible block like shadcn's Collapsible: the whole header row toggles it, a count sits before the chevron. */
export function Collapsible({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="flex flex-col gap-2 border-t p-3">{children}</div>}
    </div>
  );
}
