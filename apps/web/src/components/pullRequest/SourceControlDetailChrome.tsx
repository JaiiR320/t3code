import { PanelRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/**
 * The frame a pull request or issue opens in beside the source control list: an identity line
 * with actions, a fold holding the title and its facts, an optional nav, then the content.
 *
 * Scrolling the content past the fold condenses the frame: the fold closes, the identity line
 * swaps to its condensed form, and a one-line summary takes the fold's place. Each
 * `scrollStateKey` remembers its own state, so tabs too short to scroll cannot get stuck closed.
 * Content scrollers report through scroll capture, so whatever scrolls inside `children` drives it.
 */
export function SourceControlDetailChrome({
  ready,
  scrollStateKey,
  onClose,
  closeLabel,
  identity,
  condensedIdentity,
  actions,
  condensedSummary,
  fold,
  nav,
  floating,
  children,
}: {
  /** Whether the subject has loaded. Before then the frame keeps only its close control. */
  ready: boolean;
  scrollStateKey: string;
  onClose?: (() => void) | undefined;
  closeLabel: string;
  identity: ReactNode;
  condensedIdentity: ReactNode;
  actions?: ReactNode;
  condensedSummary: ReactNode;
  fold: ReactNode;
  nav?: ReactNode;
  /** Overlays that sit over the frame rather than scroll with it: a composer, dialogs. */
  floating?: ReactNode;
  children: ReactNode;
}) {
  const [condensed, setCondensed] = useState(false);
  const stateByKey = useRef<Partial<Record<string, boolean>>>({});
  useEffect(() => {
    setCondensed(stateByKey.current[scrollStateKey] ?? false);
  }, [scrollStateKey]);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const foldRef = useRef<HTMLDivElement | null>(null);
  const condensedRowRef = useRef<HTMLDivElement | null>(null);
  // Refund after the fold commits so the content under the reader does not jump with its height.
  const compensationRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (compensationRef.current === null) return;
    const scroller = scrollerRef.current;
    const delta = compensationRef.current;
    compensationRef.current = null;
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
  }, [condensed]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      <div
        className={cn(
          "@container/pr-header grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2",
          ready && "border-b border-border/60",
          !ready && !onClose && "hidden",
        )}
      >
        <div className="pl-4 grid h-7 min-w-0 items-center overflow-hidden">
          <div
            aria-hidden={condensed}
            inert={condensed}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-[opacity,transform] ease-out motion-reduce:transform-none motion-reduce:transition-none sm:text-xs",
              condensed
                ? "pointer-events-none -translate-y-1 opacity-0 duration-100"
                : "translate-y-0 opacity-100 delay-50 duration-150",
            )}
          >
            {ready ? identity : null}
          </div>
          <div
            aria-hidden={!condensed}
            inert={!condensed}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-[opacity,transform] ease-out motion-reduce:transform-none motion-reduce:transition-none sm:text-xs",
              condensed
                ? "translate-y-0 opacity-100 delay-50 duration-150"
                : "pointer-events-none translate-y-1 opacity-0 duration-100",
            )}
          >
            {ready ? condensedIdentity : null}
          </div>
        </div>
        <div className="mr-4 flex h-7 shrink-0 items-center justify-end gap-1">
          {ready ? actions : null}
          {onClose ? (
            <Button size="icon-xs" variant="ghost" aria-label={closeLabel} onClick={onClose}>
              <PanelRightIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            condensed
              ? "grid-rows-[1fr]"
              : "grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={condensedRowRef}
            className={cn(
              "min-h-0 overflow-hidden transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
              condensed
                ? "translate-y-0 opacity-100 delay-50"
                : "translate-y-1 opacity-0 duration-100",
            )}
            inert={!condensed}
          >
            {ready ? condensedSummary : null}
          </div>
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            // Collapse before the scroll refund paints; only reopening eases back in. Animating
            // both directions makes the shrinking track fight the scrollTop correction.
            condensed
              ? "grid-rows-[0fr]"
              : "grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={foldRef}
            className={cn(
              "min-h-0 overflow-hidden transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
              condensed
                ? "-translate-y-1 opacity-0 duration-100"
                : "translate-y-0 opacity-100 delay-50",
            )}
            inert={condensed}
          >
            {ready ? fold : null}
          </div>
        </div>

        {ready ? nav : null}
      </div>

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        onScrollCapture={(event) => {
          const scroller = event.target as HTMLElement;
          scrollerRef.current = scroller;
          const top = scroller.scrollTop;
          setCondensed((previous) => {
            let next = previous;
            const foldHeight = foldRef.current?.scrollHeight ?? 0;
            // The condensed row remains mounted, so refund only the height that actually leaves.
            const chromeDelta = foldHeight - (condensedRowRef.current?.scrollHeight ?? 0);
            if (previous) {
              // The hard top reopens the chrome with no refund: the reader asked for the top,
              // and moving them a fold's height back down would snatch it away — the fold
              // slides in above while the content stays where they left it.
              if (top < 4 && foldHeight > 0) {
                next = false;
              }
            } else if (foldHeight > 0 && top > foldHeight + 32) {
              compensationRef.current = -chromeDelta;
              next = true;
            }
            stateByKey.current[scrollStateKey] = next;
            return next;
          });
        }}
      >
        {children}
      </div>

      {floating}
    </div>
  );
}
