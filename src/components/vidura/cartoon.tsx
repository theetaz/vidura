import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CartoonButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "vidura-button min-h-11 rounded-md border-2 border-foreground bg-primary px-4 text-primary-foreground shadow-[4px_4px_0_var(--vidura-ink)] hover:-translate-y-0.5 hover:bg-primary/90 active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_var(--vidura-ink)]",
        className
      )}
      {...props}
    />
  );
}

export function StickerCard({
  className,
  ...props
}: ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        "vidura-card rounded-lg border-2 border-foreground bg-card shadow-[5px_5px_0_var(--vidura-shadow)] ring-0",
        className
      )}
      {...props}
    />
  );
}

export function StickerPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StickerCard className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-2xl font-black tracking-normal">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="text-foreground/65">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </StickerCard>
  );
}

export function MascotBubble({
  children,
  tone = "mint",
}: {
  children: ReactNode;
  tone?: "mint" | "sun" | "coral" | "sky";
}) {
  const toneClass = {
    mint: "bg-vidura-mint",
    sun: "bg-vidura-sun",
    coral: "bg-vidura-coral",
    sky: "bg-vidura-sky",
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-lg border-2 border-foreground bg-card p-3 shadow-[3px_3px_0_var(--vidura-ink)]">
      <div
        className={cn(
          "grid size-12 place-items-center rounded-md border-2 border-foreground text-2xl",
          toneClass
        )}
      >
        ෴
      </div>
      <p className="text-sm font-medium leading-snug text-foreground/75">
        {children}
      </p>
    </div>
  );
}

