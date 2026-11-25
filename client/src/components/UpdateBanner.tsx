import { Download, ExternalLink, X } from 'lucide-react';
import type { UpdateCheckResponse } from '../types/api.ts';

interface UpdateBannerProps {
  updateInfo: UpdateCheckResponse;
  onDismissSession: () => void;
  onSkipVersion: (version: string) => void;
}

export function UpdateBanner({
  updateInfo,
  onDismissSession,
  onSkipVersion,
}: UpdateBannerProps) {
  const latestVersion = updateInfo.latestVersion;
  if (!latestVersion) return null;

  const showDistinctReleaseName =
    Boolean(updateInfo.releaseName) &&
    updateInfo.releaseName!.toLowerCase() !== `v${latestVersion}`.toLowerCase() &&
    updateInfo.releaseName!.toLowerCase() !== latestVersion.toLowerCase();

  return (
    <div className="bg-[#0F1118] border border-[#46E595]/50 rounded-md px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="px-2 py-0.5 rounded text-[10px] font-mono-num uppercase tracking-wider bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/40 shrink-0">
          Update Available
        </span>
        <div className="min-w-0 text-xs text-[#EFEAE0]">
          <span className="font-mono-num font-semibold text-[#46E595]">
            v{latestVersion}
          </span>
          <span className="text-[#9CA0B0] mx-1.5">·</span>
          <span className="text-[#9CA0B0]">
            Installed{' '}
            <span className="font-mono-num text-[#EFEAE0]">v{updateInfo.currentVersion}</span>
          </span>
          {showDistinctReleaseName && (
            <>
              <span className="text-[#656A7C] mx-1.5">—</span>
              <span className="text-[#EFEAE0] truncate">{updateInfo.releaseName}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <a
          href={updateInfo.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#46E595] text-[#08090D] font-semibold text-xs hover:bg-[#5EF0A7] transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download Release</span>
          <ExternalLink className="w-3 h-3 opacity-80" />
        </a>
        <button
          type="button"
          onClick={() => onSkipVersion(latestVersion)}
          className="px-2.5 py-1 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF]/55 text-xs font-mono-num text-[#9CA0B0] hover:text-[#EFEAE0] transition-colors cursor-pointer"
        >
          Skip v{latestVersion}
        </button>
        <button
          type="button"
          onClick={onDismissSession}
          aria-label="Dismiss update notification for this session"
          className="p-1 rounded text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
