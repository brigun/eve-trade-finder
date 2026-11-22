import { useMemo, useState, type ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildCandleSeries,
  type CandlePoint,
  type OrderFlowVerdict,
} from '../lib/candleAnalytics.ts';
import {
  formatIskCompact,
  formatIskExact,
  formatPct,
  formatUnitsCompact,
} from '../lib/format.ts';
import type { HistoryPoint } from '../types/api.ts';

interface MarketCandlestickChartProps {
  history: HistoryPoint[];
  bestBid: number;
  bestAsk: number;
}

type ChartMode = 'candles' | 'line';
type HistoryWindow = 14 | 30 | 45;

const VERDICT_BADGE_STYLES: Record<OrderFlowVerdict, string> = {
  TWO_SIDED: 'bg-[#46E595]/15 text-[#46E595] border-[#46E595]/40',
  ASK_HEAVY: 'bg-[#9B7BFF]/15 text-[#B298FF] border-[#9B7BFF]/45',
  BID_HEAVY: 'bg-[#E07A63]/15 text-[#E07A63] border-[#E07A63]/45',
  LOW_ACTIVITY: 'bg-[#1D2130] text-[#9CA0B0] border-[#262938]',
};

interface CustomTooltipPayloadItem {
  payload?: CandlePoint;
}

function CandleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const biasLabel =
    pt.flowBias === 'BID_HEAVY'
      ? 'Sold into Buy Orders'
      : pt.flowBias === 'ASK_HEAVY'
        ? 'Bought off Sell Orders'
        : 'Two-Sided Flow';

  const biasColor =
    pt.flowBias === 'BID_HEAVY'
      ? 'text-[#E07A63]'
      : pt.flowBias === 'ASK_HEAVY'
        ? 'text-[#B298FF]'
        : 'text-[#46E595]';

  return (
    <div className="rounded-md bg-[#08090D]/95 border border-[#262938] px-3 py-2.5 shadow-xl text-[11px] font-mono-num space-y-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-3 border-b border-[#262938] pb-1">
        <span className="text-[#EFEAE0] font-semibold">{pt.date}</span>
        <span className={pt.isUp ? 'text-[#46E595]' : 'text-[#FF4D6D]'}>
          {pt.isUp ? '▲ Up' : '▼ Down'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-[#656A7C]">High (Ask Fill):</span>
        <span className="text-right text-[#EFEAE0]">{formatIskExact(pt.highest)} ISK</span>

        <span className="text-[#656A7C]">Weighted Avg:</span>
        <span className="text-right text-[#EFEAE0] font-semibold">
          {formatIskExact(pt.average)} ISK
        </span>

        <span className="text-[#656A7C]">Low (Bid Fill):</span>
        <span className="text-right text-[#EFEAE0]">{formatIskExact(pt.lowest)} ISK</span>

        <span className="text-[#656A7C]">Daily Spread:</span>
        <span className="text-right text-[#9CA0B0]">{formatPct(pt.rangePct)}</span>

        <span className="text-[#656A7C]">Volume / Orders:</span>
        <span className="text-right text-[#9CA0B0]">
          {pt.volume.toLocaleString()} / {pt.orderCount.toLocaleString()}
        </span>
      </div>

      <div className="pt-1 border-t border-[#262938] space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[#656A7C]">Flow Inference:</span>
          <span className={`font-semibold ${biasColor}`}>{biasLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[#E07A63]">
            Bid Fills: {Math.round(pt.bidShare * 100)}% ({formatUnitsCompact(pt.estBidVolume)})
          </span>
          <span className="text-[#B298FF]">
            Ask Fills: {Math.round(pt.askShare * 100)}% ({formatUnitsCompact(pt.estAskVolume)})
          </span>
        </div>
      </div>
    </div>
  );
}

function VolumeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="rounded-md bg-[#08090D]/95 border border-[#262938] px-3 py-2 shadow-xl text-[11px] font-mono-num space-y-1">
      <div className="text-[#EFEAE0] font-semibold">
        {pt.date} · {pt.volume.toLocaleString()} units ({pt.orderCount.toLocaleString()} orders)
      </div>
      <div className="flex items-center justify-between gap-4 text-[#9B7BFF]">
        <span>Est. Bought off Sell Orders:</span>
        <span>
          {pt.estAskVolume.toLocaleString()} ({Math.round(pt.askShare * 100)}%)
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[#E07A63]">
        <span>Est. Sold to Buy Orders:</span>
        <span>
          {pt.estBidVolume.toLocaleString()} ({Math.round(pt.bidShare * 100)}%)
        </span>
      </div>
    </div>
  );
}

interface CandleShapeInput {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandlePoint;
  isActive?: boolean;
}

function renderCandleShape(shapeProps: unknown): ReactElement {
  const { x, y, width, height, payload, isActive } = (shapeProps ?? {}) as CandleShapeInput;
  if (
    !payload ||
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return <g />;
  }

  const safeHeight = Math.max(0, height);
  const topY = y;
  const bottomY = y + safeHeight;
  const span = payload.highest - payload.lowest;

  const toY = (price: number): number => {
    if (span <= 0 || safeHeight <= 0) return topY;
    return topY + ((payload.highest - price) / span) * (bottomY - topY);
  };

  const centerX = x + width / 2;
  const candleWidth = Math.max(4, Math.min(12, width * 0.65));
  const color = payload.isUp ? '#46E595' : '#FF4D6D';

  const openY = toY(payload.bodyOpen);
  const closeY = toY(payload.bodyClose);
  const avgY = toY(payload.average);

  const rawBodyH = Math.abs(closeY - openY);
  const bodyH = Math.max(2, rawBodyH);
  const bodyTop =
    rawBodyH < 2 ? (openY + closeY) / 2 - bodyH / 2 : Math.min(openY, closeY);

  return (
    <g>
      <line
        x1={centerX}
        y1={topY}
        x2={centerX}
        y2={bottomY}
        stroke={color}
        strokeWidth={isActive ? 2 : 1.5}
      />
      <rect
        x={centerX - candleWidth / 2}
        y={bodyTop}
        width={candleWidth}
        height={bodyH}
        rx={1}
        fill={color}
        fillOpacity={isActive ? 1 : 0.82}
        stroke={color}
        strokeWidth={1}
      />
      <line
        x1={centerX - candleWidth / 2 - 1}
        y1={avgY}
        x2={centerX + candleWidth / 2 + 1}
        y2={avgY}
        stroke="#EFEAE0"
        strokeWidth={1.5}
      />
    </g>
  );
}

export function MarketCandlestickChart({
  history,
  bestBid,
  bestAsk,
}: MarketCandlestickChartProps) {
  const [mode, setMode] = useState<ChartMode>('candles');
  const [windowDays, setWindowDays] = useState<HistoryWindow>(30);

  const model = useMemo(
    () => buildCandleSeries(history, { bestBid, bestAsk, days: windowDays }),
    [history, bestBid, bestAsk, windowDays],
  );

  const { summary } = model;

  return (
    <div className="space-y-3">
      {/* Controls & Order-Flow Verdict Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono-num font-semibold uppercase tracking-wider border ${VERDICT_BADGE_STYLES[summary.verdict]}`}
          >
            {summary.verdictLabel}
          </span>
          <span className="text-[11px] text-[#9CA0B0]">{summary.verdictDetail}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex rounded bg-[#08090D] border border-[#262938] p-0.5 text-[10px] font-mono-num">
            {(['candles', 'line'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded cursor-pointer capitalize ${
                  mode === m
                    ? 'bg-[#9B7BFF]/25 text-[#EFEAE0]'
                    : 'text-[#9CA0B0] hover:text-[#EFEAE0]'
                }`}
              >
                {m === 'candles' ? 'Candles' : 'Line'}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded bg-[#08090D] border border-[#262938] p-0.5 text-[10px] font-mono-num">
            {([14, 30, 45] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setWindowDays(d)}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  windowDays === d
                    ? 'bg-[#9B7BFF]/25 text-[#EFEAE0]'
                    : 'text-[#9CA0B0] hover:text-[#EFEAE0]'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Order-Flow Balance Meter */}
      <div className="rounded bg-[#08090D]/60 border border-[#262938] px-3 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-num">
          <span className="text-[#E07A63]">
            Bid Fills (Sold to Buy Orders): {summary.bidSharePct.toFixed(0)}%
          </span>
          <span className="text-[#656A7C]">
            {summary.twoSidedDays} two-sided · {summary.bidHeavyDays} bid-heavy ·{' '}
            {summary.askHeavyDays} ask-heavy
          </span>
          <span className="text-[#B298FF]">
            Ask Fills (Bought off Sell Orders): {summary.askSharePct.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full overflow-hidden bg-[#1D2130] flex">
          <div
            className="h-full bg-[#E07A63]"
            style={{ width: `${Math.max(0, Math.min(100, summary.bidSharePct))}%` }}
          />
          <div
            className="h-full bg-[#9B7BFF]"
            style={{ width: `${Math.max(0, Math.min(100, summary.askSharePct))}%` }}
          />
        </div>
      </div>

      {/* Chart Body */}
      {mode === 'candles' ? (
        <div className="space-y-1">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={model.candles}
                syncId="jita-item-history"
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="#262938" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis
                  domain={model.priceDomain}
                  tick={{ fill: '#9CA0B0', fontSize: 10 }}
                  tickFormatter={(v: number) => formatIskCompact(v, false)}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip
                  content={<CandleTooltip />}
                  cursor={{ fill: '#9B7BFF', fillOpacity: 0.08 }}
                />
                {model.showBestBidLine && (
                  <ReferenceLine y={bestBid} stroke="#E07A63" strokeDasharray="4 4" />
                )}
                {model.showBestAskLine && (
                  <ReferenceLine y={bestAsk} stroke="#B298FF" strokeDasharray="4 4" />
                )}
                <Bar
                  dataKey="candleRange"
                  isAnimationActive={false}
                  minPointSize={0}
                  shape={renderCandleShape}
                  activeBar={renderCandleShape}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={model.candles}
                syncId="jita-item-history"
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="#262938" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#656A7C', fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)}
                  axisLine={{ stroke: '#262938' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#656A7C', fontSize: 10 }}
                  tickFormatter={(v: number) => formatUnitsCompact(v)}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip
                  content={<VolumeTooltip />}
                  cursor={{ fill: '#9B7BFF', fillOpacity: 0.08 }}
                />
                <Bar
                  dataKey="estBidVolume"
                  stackId="flow"
                  name="Sold to Buy Orders"
                  fill="#E07A63"
                  fillOpacity={0.78}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="estAskVolume"
                  stackId="flow"
                  name="Bought off Sell Orders"
                  fill="#9B7BFF"
                  fillOpacity={0.82}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={model.candles}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke="#262938" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#656A7C', fontSize: 10 }}
                tickFormatter={(v: string) => v.slice(5)}
                axisLine={{ stroke: '#262938' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="price"
                orientation="left"
                domain={model.priceDomain}
                tick={{ fill: '#9CA0B0', fontSize: 10 }}
                tickFormatter={(v: number) => formatIskCompact(v, false)}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <YAxis
                yAxisId="vol"
                orientation="right"
                tick={{ fill: '#656A7C', fontSize: 10 }}
                tickFormatter={(v: number) => formatUnitsCompact(v)}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#08090D',
                  border: '1px solid #262938',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono, monospace',
                  color: '#EFEAE0',
                }}
                formatter={(value: unknown, name: string) => {
                  const num = Number(value);
                  if (name === 'Volume') return [num.toLocaleString() + ' units', name];
                  return [formatIskExact(num) + ' ISK', name];
                }}
              />
              <Bar
                yAxisId="vol"
                dataKey="volume"
                name="Volume"
                fill="#9B7BFF"
                fillOpacity={0.28}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="highest"
                name="Daily High"
                stroke="#656A7C"
                strokeWidth={1}
                strokeDasharray="2 3"
                dot={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="lowest"
                name="Daily Low"
                stroke="#656A7C"
                strokeWidth={1}
                strokeDasharray="2 3"
                dot={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="average"
                name="Avg Price"
                stroke="#46E595"
                strokeWidth={2}
                dot={false}
              />
              {model.showBestBidLine && (
                <ReferenceLine
                  yAxisId="price"
                  y={bestBid}
                  stroke="#E07A63"
                  strokeDasharray="4 4"
                />
              )}
              {model.showBestAskLine && (
                <ReferenceLine
                  yAxisId="price"
                  y={bestAsk}
                  stroke="#B298FF"
                  strokeDasharray="4 4"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend & Methodology Note */}
      <div className="pt-1 border-t border-[#262938]/70 space-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono-num text-[#9CA0B0]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[1px] bg-[#46E595]" /> Up Candle
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[1px] bg-[#FF4D6D]" /> Down Candle
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-[2px] bg-[#EFEAE0]" /> Daily Avg Tick
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0 border-t border-dashed border-[#B298FF]" /> Best Ask
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0 border-t border-dashed border-[#E07A63]" /> Best Bid
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[1px] bg-[#E07A63]/80" /> Est. Bid Fills
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[1px] bg-[#9B7BFF]/80" /> Est. Ask Fills
          </span>
        </div>

        <p className="text-[10px] text-[#656A7C] leading-snug">
          ESI reports daily Low/Avg/High (no Open/Close): wicks show Low–High, bodies track Prev
          Avg → Avg inside the day&apos;s range, and Bid/Ask volume split is inferred from where Avg
          cleared between Low and High.
          {(!model.showBestAskLine || !model.showBestBidLine) && (
            <span className="ml-1 text-[#9CA0B0]">
              (Current {!model.showBestAskLine && !model.showBestBidLine
                ? 'Best Bid & Best Ask are'
                : !model.showBestAskLine
                  ? 'Best Ask is'
                  : 'Best Bid is'}{' '}
              off-scale vs. historical range and hidden to keep candles readable.)
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
