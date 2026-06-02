import Link from 'next/link';

type LogoVariant = 'default' | 'white' | 'orange';

export function Logo({
  variant = 'default',
  className = '',
}: {
  variant?: LogoVariant;
  className?: string;
}) {
  const style =
    variant === 'white'
      ? { filter: 'brightness(0) invert(1)' }
      : variant === 'orange'
      ? { filter: 'sepia(1) saturate(10000%) hue-rotate(330deg) brightness(0.95)' }
      : undefined;

  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`}>
      <img
        src="/Logo-2.png"
        alt="Aero Sarathi"
        className="max-h-14 h-auto w-auto object-contain"
        style={style as React.CSSProperties}
      />
    </Link>
  );
}
