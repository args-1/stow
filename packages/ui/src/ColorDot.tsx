export interface ColorDotProps {
  color: string | null | undefined;
  className?: string;
}

export function ColorDot({ color, className = '' }: ColorDotProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color ?? '#94a3b8' }}
    />
  );
}
