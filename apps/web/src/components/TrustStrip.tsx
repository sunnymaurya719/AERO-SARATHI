import { BadgeCheck, CreditCard, Clock, MapPin, Wallet } from 'lucide-react';

const ITEMS = [
  { icon: BadgeCheck, text: 'Verified Drivers' },
  { icon: CreditCard, text: 'Secure Online Payment' },
  { icon: Clock, text: '24/7 Support' },
  { icon: MapPin, text: 'Live GPS Tracking' },
  { icon: Wallet, text: 'No Hidden Charges' },
];

export function TrustStrip() {
  return (
    <div className="border-y border-sand-100 bg-white px-6 py-8 md:px-12">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-4 md:justify-around">
        {ITEMS.map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={item.text} className="flex items-center gap-2.5">
              {i > 0 && <span className="mr-5 hidden h-8 w-px bg-sand-100 md:block" />}
              <Icon className="h-6 w-6 text-brand-orange" />
              <span className="text-sm font-medium text-brand-navy">{item.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
