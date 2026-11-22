import { useState } from 'react';
import { itemIconUrl } from '../lib/format.ts';

interface ItemIconProps {
  typeId: number;
  name: string;
  size?: 32 | 64;
  className?: string;
}

export function ItemIcon({ typeId, name, size = 32, className = 'w-8 h-8' }: ItemIconProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`${className} shrink-0 rounded bg-[#1D2130] border border-[#262938] flex items-center justify-center font-mono-num text-[10px] text-[#9CA0B0] uppercase`}
        title={name}
      >
        {name.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={itemIconUrl(typeId, size)}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${className} shrink-0 rounded bg-[#08090D] border border-[#262938] object-contain`}
    />
  );
}
