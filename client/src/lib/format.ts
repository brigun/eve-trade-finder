export function formatIskCompact(val: number | null | undefined, withSuffix = true): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  let text: string;
  if (abs >= 1_000_000_000_000) {
    text = `${(abs / 1_000_000_000_000).toFixed(2)}T`;
  } else if (abs >= 1_000_000_000) {
    text = `${(abs / 1_000_000_000).toFixed(2)}B`;
  } else if (abs >= 1_000_000) {
    text = `${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 10_000) {
    text = `${(abs / 1_000).toFixed(1)}K`;
  } else {
    text = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return `${sign}${text}${withSuffix ? ' ISK' : ''}`;
}

export function formatIskExact(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUnitsCompact(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 10_000) return `${(val / 1_000).toFixed(1)}K`;
  if (val >= 100) return Math.round(val).toLocaleString('en-US');
  return val.toFixed(1);
}

export function formatPct(val: number | null | undefined, showSign = false): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = showSign && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

export function parseIskShorthand(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/[,_\s]|isk/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2];
  if (suffix === 'k') return base * 1_000;
  if (suffix === 'm') return base * 1_000_000;
  if (suffix === 'b') return base * 1_000_000_000;
  return base;
}

export function formatShorthandInput(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '';
  if (val >= 1_000_000_000 && val % 100_000_000 === 0) return `${val / 1_000_000_000}b`;
  if (val >= 1_000_000 && val % 100_000 === 0) return `${val / 1_000_000}m`;
  if (val >= 1_000 && val % 100 === 0) return `${val / 1_000}k`;
  return String(val);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return 'just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function eveTickStep(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const magnitude = Math.floor(Math.log10(price));
  return Math.max(0.01, Math.pow(10, magnitude - 3));
}

export function roundToEveSigFigs(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const step = eveTickStep(price);
  const rounded = Math.round(price / step) * step;
  const decimals = step < 1 ? Math.max(0, Math.round(-Math.log10(step))) : 0;
  return Number(Math.max(0.01, rounded).toFixed(decimals));
}

export function nextEveTick(price: number, direction: 'up' | 'down'): number {
  const p = roundToEveSigFigs(price);
  if (direction === 'up') {
    return roundToEveSigFigs(p + eveTickStep(p));
  }
  if (p <= 0.01) return 0.01;
  const log10 = Math.log10(p);
  const nearestPow = Math.round(log10);
  if (p >= 100 && Math.abs(log10 - nearestPow) < 1e-9) {
    const stepBelow = Math.max(0.01, Math.pow(10, nearestPow - 4));
    return roundToEveSigFigs(p - stepBelow);
  }
  return roundToEveSigFigs(Math.max(0.01, p - eveTickStep(p)));
}

export function itemIconUrl(typeId: number, size: 32 | 64 = 64): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

export function characterPortraitUrl(characterId: number, size: 64 | 128 = 64): string {
  return `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;
}
