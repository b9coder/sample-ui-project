// Minimal shadcn-style primitives (hand-rolled; swap for shadcn CLI output any time).
import clsx from "clsx";

export function Card({ className, children }) {
  return (
    <div className={clsx("rounded-xl border border-border bg-card shadow-sm", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description }) {
  if (!title && !description) return null;
  return (
    <div className="px-4 pt-4">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

export function CardContent({ className, children }) {
  return <div className={clsx("p-4", className)}>{children}</div>;
}

export function Button({ className, variant = "default", ...props }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "default" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "outline" && "border border-border bg-card hover:bg-muted",
        variant === "ghost" && "hover:bg-muted",
        className
      )}
      {...props}
    />
  );
}

const badgeIntent = {
  critical: "bg-red-100 text-red-700",
  high: "bg-amber-100 text-amber-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-emerald-100 text-emerald-700",
  default: "bg-muted text-muted-foreground",
};

export function Badge({ children, intent }) {
  const key = String(intent ?? children ?? "").toLowerCase();
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        badgeIntent[key] || badgeIntent.default
      )}
    >
      {children}
    </span>
  );
}
