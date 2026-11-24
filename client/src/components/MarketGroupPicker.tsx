import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderTree, Search, X } from 'lucide-react';
import type { MarketGroupTreeNode } from '../types/api.ts';

interface MarketGroupPickerProps {
  tree: MarketGroupTreeNode[];
  selectedGroupId: number | null;
  onSelect: (groupId: number | null) => void;
  breaking?: boolean;
  breakingReason?: string;
}

function findNodeAndAncestors(
  nodes: MarketGroupTreeNode[],
  targetId: number,
  ancestors: number[] = [],
): { node: MarketGroupTreeNode; ancestors: number[] } | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return { node, ancestors };
    }
    if (node.children.length > 0) {
      const found = findNodeAndAncestors(node.children, targetId, [...ancestors, node.id]);
      if (found) return found;
    }
  }
  return null;
}

function filterTree(
  nodes: MarketGroupTreeNode[],
  queryLower: string,
  autoExpanded: Set<number>,
): MarketGroupTreeNode[] {
  const result: MarketGroupTreeNode[] = [];

  for (const node of nodes) {
    const nameMatch = node.name.toLowerCase().includes(queryLower);
    const filteredChildren = filterTree(node.children, queryLower, autoExpanded);

    if (nameMatch || filteredChildren.length > 0) {
      if (filteredChildren.length > 0) {
        autoExpanded.add(node.id);
      }
      result.push({
        ...node,
        children: nameMatch && filteredChildren.length === 0 ? node.children : filteredChildren,
      });
    }
  }

  return result;
}

export function MarketGroupPicker({
  tree,
  selectedGroupId,
  onSelect,
  breaking = false,
  breakingReason,
}: MarketGroupPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedMatch = useMemo(
    () => (selectedGroupId !== null ? findNodeAndAncestors(tree, selectedGroupId) : null),
    [tree, selectedGroupId],
  );

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleOpenToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      if (selectedMatch && selectedMatch.ancestors.length > 0) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          for (const id of selectedMatch.ancestors) next.add(id);
          return next;
        });
      }
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const queryLower = search.trim().toLowerCase();
  const { visibleTree, searchExpanded } = useMemo(() => {
    if (!queryLower) {
      return { visibleTree: tree, searchExpanded: new Set<number>() };
    }
    const autoExpanded = new Set<number>();
    const filtered = filterTree(tree, queryLower, autoExpanded);
    return { visibleTree: filtered, searchExpanded: autoExpanded };
  }, [tree, queryLower]);

  const renderNodes = (nodes: MarketGroupTreeNode[], depth: number) =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = queryLower ? searchExpanded.has(node.id) : expandedIds.has(node.id);
      const isSelected = node.id === selectedGroupId;
      const isMatch = queryLower.length > 0 && node.name.toLowerCase().includes(queryLower);

      return (
        <div key={node.id}>
          <div
            className={`flex items-center justify-between gap-2 pr-2.5 py-1 text-xs rounded transition-colors ${
              isSelected
                ? 'bg-[#9B7BFF]/20 text-[#EFEAE0]'
                : 'hover:bg-[#161923] text-[#9CA0B0] hover:text-[#EFEAE0]'
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(node.id);
                  }}
                  aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                  className="p-0.5 rounded hover:bg-[#1D2130] text-[#656A7C] hover:text-[#EFEAE0] shrink-0 cursor-pointer"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-[#9B7BFF]" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4.5 shrink-0 inline-block text-center text-[#262938]">•</span>
              )}

              <button
                type="button"
                onClick={() => {
                  onSelect(node.id);
                  setOpen(false);
                }}
                className={`text-left truncate flex-1 py-0.5 cursor-pointer ${
                  isSelected
                    ? 'font-semibold text-[#EFEAE0]'
                    : isMatch
                      ? 'font-medium text-[#B298FF]'
                      : ''
                }`}
                title={node.path.join(' › ')}
              >
                {node.name}
              </button>
            </div>

            <span className="font-mono-num text-[10px] text-[#656A7C] shrink-0">
              {node.itemCount.toLocaleString()}
            </span>
          </div>

          {hasChildren && isExpanded && (
            <div className="border-l border-[#262938]/70 ml-3.5">
              {renderNodes(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  const triggerLabel = selectedMatch
    ? selectedMatch.node.path.join(' › ')
    : 'All Market Segments';

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <div
        title={breaking ? breakingReason : undefined}
        className={`inline-flex items-center rounded border transition-colors ${
          breaking
            ? 'bg-[#FF4D6D]/12 border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60'
            : 'bg-[#08090D] border-[#262938] hover:border-[#9B7BFF]/60'
        }`}
      >
        <button
          type="button"
          onClick={handleOpenToggle}
          aria-expanded={open}
          aria-label="Select EVE Market Segment"
          className={`inline-flex items-center gap-2 px-2.5 py-1 text-xs cursor-pointer max-w-[320px] sm:max-w-[400px] ${
            breaking ? 'text-[#FF4D6D]' : 'text-[#EFEAE0]'
          }`}
        >
          <FolderTree
            className={`w-3.5 h-3.5 shrink-0 ${breaking ? 'text-[#FF4D6D]' : 'text-[#9B7BFF]'}`}
          />
          <span className="truncate" title={triggerLabel}>
            {triggerLabel}
          </span>
          {selectedMatch && (
            <span className="px-1.5 py-0.2 rounded bg-[#9B7BFF]/18 text-[#B298FF] font-mono-num text-[10px] shrink-0">
              {selectedMatch.node.itemCount.toLocaleString()}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#656A7C] shrink-0 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {selectedGroupId !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            title="Clear market segment filter"
            aria-label="Clear market segment filter"
            className="pr-2 pl-1 py-1 text-[#656A7C] hover:text-[#FF4D6D] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-40 w-[380px] sm:w-[440px] max-w-[92vw] bg-[#0F1118] border border-[#262938] rounded-md shadow-2xl overflow-hidden">
          {/* Sticky Search Header */}
          <div className="p-2 bg-[#161923] border-b border-[#262938]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#656A7C] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search segments (e.g. Armor Hardeners, Cruisers)..."
                className="w-full pl-8 pr-7 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0] placeholder:text-[#656A7C]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear segment search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#656A7C] hover:text-[#EFEAE0] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Segment Tree Body */}
          <div className="max-h-[380px] overflow-y-auto p-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                selectedGroupId === null
                  ? 'bg-[#9B7BFF]/20 text-[#EFEAE0] font-semibold'
                  : 'text-[#9CA0B0] hover:bg-[#161923] hover:text-[#EFEAE0]'
              }`}
            >
              <span>All Market Segments</span>
              <span className="font-mono-num text-[10px] text-[#656A7C]">All</span>
            </button>

            <div className="border-t border-[#262938]/70 my-1" />

            {visibleTree.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#656A7C]">
                {tree.length === 0
                  ? 'Sync Jita 4-4 first to populate market segments.'
                  : `No market segments match "${search}"`}
              </div>
            ) : (
              renderNodes(visibleTree, 0)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
