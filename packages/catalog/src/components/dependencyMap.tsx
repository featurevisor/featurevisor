import * as React from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { getDependencyMap, type DependencyMap, type DependencyMapNode } from "../dependencyMap";
import { getEntityRoute } from "../entityTypes";
import type { EntityDetail, EntitySummary } from "../types";
import { useCatalogIndex } from "../useCatalogIndex";
import { typeName, useSummaryLookup } from "./dependencies";

/** Columns fit their longest key between these widths, and longer keys are cut with an ellipsis */
const MIN_NODE_WIDTH = 152;
const MAX_NODE_WIDTH = 248;
/** Roughly the width of one character of a key, at the size nodes show keys */
const KEY_CHARACTER_WIDTH = 7.6;
const NODE_HEIGHT = 44;
const CENTER_HEIGHT = 52;
const MORE_HEIGHT = 30;
/** Gaps widen with the tallest jump a line makes across them, so long lines stay gentle curves */
const MIN_COLUMN_GAP = 72;
const MAX_COLUMN_GAP = 168;
const ROW_GAP = 12;
const PADDING = 24;
/** Room above the columns for the two side labels */
const LABEL_HEIGHT = 26;
/** `?map=full` on the Usage tab opens the full view */
export const FULL_VIEW_PARAM = "map";
export const FULL_VIEW_VALUE = "full";
/** Taller than this, and the map scrolls and drags inside its frame */
const VIEWPORT_HEIGHT = 440;

interface PlacedNode extends DependencyMapNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MapLayout {
  width: number;
  height: number;
  center: PlacedNode;
  nodes: PlacedNode[];
  positions: Map<string, PlacedNode>;
  more: Array<{ side: Side; count: number; x: number; y: number; width: number; column: number }>;
  labels: Array<{ text: string; x: number; width: number }>;
}

type Side = "dependencies" | "dependents";

interface MapColumn {
  nodes: DependencyMapNode[];
  /** Undefined for the entity's own column in the middle */
  side?: Side;
  /** Steps away from the middle, from 0 */
  index: number;
}

/** Columns from the far left to the far right, each centred on the tallest one */
function layoutMap(map: DependencyMap): MapLayout {
  const columns: MapColumn[] = [
    ...map.dependencies.map((nodes, index) => ({ nodes, side: "dependencies" as const, index })),
  ].reverse();
  columns.push({ nodes: [map.center], index: 0 });
  map.dependents.forEach((nodes, index) => columns.push({ nodes, side: "dependents", index }));

  // The outermost column on a side ends with what the map leaves out
  const endsWithMore = (column: MapColumn) =>
    column.side !== undefined &&
    column.index === map[column.side].length - 1 &&
    map.more[column.side] > 0;
  const columnHeight = (column: MapColumn) =>
    column.side === undefined
      ? CENTER_HEIGHT
      : column.nodes.length * NODE_HEIGHT +
        (column.nodes.length - 1) * ROW_GAP +
        (endsWithMore(column) ? ROW_GAP + MORE_HEIGHT : 0);
  const tallest = Math.max(...columns.map(columnHeight));
  const top = PADDING + LABEL_HEIGHT;
  const widths = columns.map((column) =>
    Math.round(
      Math.min(
        MAX_NODE_WIDTH,
        Math.max(
          MIN_NODE_WIDTH,
          Math.max(...column.nodes.map((node) => node.key.length)) * KEY_CHARACTER_WIDTH + 28,
        ),
      ),
    ),
  );

  const nodes: PlacedNode[] = [];
  const more: MapLayout["more"] = [];
  let center: PlacedNode = { ...map.center, x: 0, y: 0, width: 0, height: CENTER_HEIGHT };
  const columnOf = new Map<string, number>();
  columns.forEach((column, columnIndex) => {
    const x = 0;
    const width = widths[columnIndex];
    column.nodes.forEach((node) => columnOf.set(node.id, columnIndex));
    let y = top + (tallest - columnHeight(column)) / 2;
    if (column.side === undefined) {
      center = { ...map.center, x, y, width, height: CENTER_HEIGHT };
      return;
    }
    for (const node of column.nodes) {
      nodes.push({ ...node, x, y, width, height: NODE_HEIGHT });
      y += NODE_HEIGHT + ROW_GAP;
    }
    if (endsWithMore(column)) {
      more.push({
        side: column.side,
        count: map.more[column.side],
        x,
        y,
        width,
        column: columnIndex,
      });
    }
  });

  // Each gap is as wide as the steepest line crossing it needs
  const gaps = widths.slice(1).map(() => MIN_COLUMN_GAP);
  const middle = (node: PlacedNode) => node.y + node.height / 2;
  const placed = new Map(nodes.map((node) => [node.id, node]));
  placed.set(center.id, center);
  for (const edge of map.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const gap = Math.min(columnOf.get(edge.from)!, columnOf.get(edge.to)!);
    const rise = Math.abs(middle(from) - middle(to));
    gaps[gap] = Math.max(gaps[gap], Math.min(MAX_COLUMN_GAP, rise * 0.18));
  }
  const offsets = widths.map((_, index) =>
    widths.slice(0, index).reduce((sum, width, previous) => sum + width + gaps[previous], PADDING),
  );
  for (const node of [...nodes, center]) node.x = offsets[columnOf.get(node.id)!];
  for (const item of more) item.x = offsets[item.column];

  // Each column says how it relates, so a label stays in view wherever the map is dragged
  const labels: MapLayout["labels"] = columns.flatMap((column, columnIndex) =>
    column.side === undefined
      ? []
      : [
          {
            text:
              column.index > 0
                ? "Indirectly"
                : column.side === "dependencies"
                  ? "Depends on"
                  : "Used by",
            x: offsets[columnIndex],
            width: widths[columnIndex],
          },
        ],
  );

  return {
    width: offsets[offsets.length - 1] + widths[widths.length - 1] + PADDING,
    height: top + tallest + PADDING,
    center,
    nodes,
    positions: placed,
    more,
    labels,
  };
}

/** A smooth S from the right side of one node to the left side of the next */
function edgePath(from: PlacedNode, to: PlacedNode) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

/** The lines and entities between one entity on the map and the one the page is about */
function getPathToCenter(map: DependencyMap, from: string) {
  // Each line's outer end leads one column closer to the centre
  const inwards = new Map<string, Array<{ edge: string; inner: string }>>();
  const dependencySide = new Set(map.dependencies.flat().map((node) => node.id));
  for (const edge of map.edges) {
    const outer = dependencySide.has(edge.from) ? edge.from : edge.to;
    const inner = outer === edge.from ? edge.to : edge.from;
    const list = inwards.get(outer) || [];
    list.push({ edge: `${edge.from}>${edge.to}`, inner });
    inwards.set(outer, list);
  }
  const edges = new Set<string>();
  const nodes = new Set<string>([from]);
  const queue = [from];
  for (let index = 0; index < queue.length; index++) {
    for (const step of inwards.get(queue[index]) || []) {
      edges.add(step.edge);
      if (!nodes.has(step.inner)) {
        nodes.add(step.inner);
        queue.push(step.inner);
      }
    }
  }
  return { edges, nodes };
}

/**
 * Lets a mouse drag the map around inside its frame, while touch keeps native scrolling. A drag
 * never ends in a click, so letting go over an entity does not open it.
 */
function useDragToPan(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);

  const handlers = {
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      if (!enabled || event.pointerType !== "mouse" || event.button !== 0 || !ref.current) return;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: ref.current.scrollLeft,
        top: ref.current.scrollTop,
        moved: false,
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
      const state = drag.current;
      const element = ref.current;
      if (!state || !element) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        state.moved = true;
        setDragging(true);
        // Keeps the drag going when the pointer leaves the frame. A pointer the browser no longer
        // tracks cannot be captured, and the drag still works without it.
        try {
          element.setPointerCapture(event.pointerId);
        } catch {}
      }
      if (state.moved) {
        element.scrollLeft = state.left - dx;
        element.scrollTop = state.top - dy;
      }
    },
    onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
      if (drag.current?.moved) {
        suppressClick.current = true;
        if (ref.current?.hasPointerCapture(event.pointerId)) {
          ref.current.releasePointerCapture(event.pointerId);
        }
      }
      drag.current = null;
      setDragging(false);
    },
    onPointerCancel() {
      drag.current = null;
      setDragging(false);
    },
    onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return { ref, dragging, handlers };
}

/** One entity's dependency map, undefined when it has no dependencies and no dependents */
export function useDependencyMap(detail: EntityDetail, setKey?: string) {
  const { index } = useCatalogIndex(setKey);
  return React.useMemo(() => getDependencyMap(detail, index), [detail, index]);
}

/**
 * What an entity depends on and what depends on it, drawn as a map: the entity in the middle,
 * its dependencies to the left and its dependents to the right, a column for each step away.
 * Hovering an entity traces its way to the middle. A map larger than its frame drags, and opens
 * in a full view that takes most of the window.
 */
export function DependencyMapView(props: {
  map: DependencyMap;
  setKey?: string;
  /** Shows where the entities a side leaves out are listed */
  onMore?: (side: Side) => void;
}) {
  const { onMore } = props;
  const layout = React.useMemo(() => layoutMap(props.map), [props.map]);
  const expandRef = React.useRef<HTMLButtonElement | null>(null);

  // The full view lives in the URL, so a link to it opens it for whoever follows the link
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const expanded = searchParams.get(FULL_VIEW_PARAM) === FULL_VIEW_VALUE;
  const openedHere = (location.state as { openedFullMap?: boolean } | null)?.openedFullMap;

  // Opening adds a history entry, so Back closes it, as it would any page
  const open = () => {
    const next = new URLSearchParams(searchParams);
    next.set(FULL_VIEW_PARAM, FULL_VIEW_VALUE);
    setSearchParams(next, { state: { openedFullMap: true } });
  };
  // Closing returns to the entry it was opened from. Arriving through a link, there is none to
  // return to here, so it takes the full view out of the URL instead.
  const close = React.useCallback(() => {
    if (openedHere) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(FULL_VIEW_PARAM);
    setSearchParams(next, { replace: true });
  }, [openedHere, navigate, searchParams, setSearchParams]);

  // Once closed, however that happened, focus goes back to the button that opened it, or the
  // list a "more below" asked for comes into view
  const pendingMore = React.useRef<Side | null>(null);
  const wasExpanded = React.useRef(expanded);
  React.useEffect(() => {
    if (wasExpanded.current && !expanded) {
      const side = pendingMore.current;
      pendingMore.current = null;
      if (side) onMore?.(side);
      else expandRef.current?.focus();
    }
    wasExpanded.current = expanded;
  }, [expanded, onMore]);

  return (
    <>
      <MapCanvas
        map={props.map}
        layout={layout}
        setKey={props.setKey}
        onMore={props.onMore}
        onExpand={open}
        expandRef={expandRef}
      />
      {/* Server rendering, as tests do, has no document to show it over */}
      {expanded &&
        typeof document !== "undefined" &&
        createPortal(
          <MapDialog
            map={props.map}
            layout={layout}
            setKey={props.setKey}
            onClose={close}
            onMore={(side) => {
              pendingMore.current = side;
              close();
            }}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * The full view: the map over the page, filling the window less a margin. Escape or the close
 * button returns to the page, the page stays still behind it, and Tab stays inside it.
 */
function MapDialog(props: {
  map: DependencyMap;
  layout: MapLayout;
  setKey?: string;
  onClose: () => void;
  onMore: (side: Side) => void;
}) {
  const { onClose } = props;
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  // The latest close, so the effect below runs once for each time the view opens
  const closeLatest = React.useRef(onClose);
  closeLatest.current = onClose;

  React.useEffect(() => {
    closeRef.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeLatest.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function keepFocusInside(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button") || []),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex bg-background/80 p-3 backdrop-blur-sm sm:p-6"
      onPointerDown={(event) => {
        // A press on the backdrop, outside the panel, closes it
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Dependency map of ${props.map.center.key}`}
        onKeyDown={keepFocusInside}
        className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text">Dependency map</h2>
            <p className="truncate text-xs text-muted">
              {typeName(props.map.center)} {props.map.center.key}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the full view"
            title="Close (Esc)"
            className={controlClass}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <MapCanvas
            map={props.map}
            layout={props.layout}
            setKey={props.setKey}
            onMore={props.onMore}
            full
          />
        </div>
      </div>
    </div>
  );
}

const controlClass =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-muted shadow-sm outline-none transition-colors hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary";

/** The map's own controls, smaller than the close button so they sit quietly in its corner */
const cornerControlClass =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-muted shadow-sm outline-none transition-colors hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary [&>svg]:h-3 [&>svg]:w-3";

/** The map itself: its scrolling frame, what it draws, and the controls in its corner */
function MapCanvas(props: {
  map: DependencyMap;
  layout: MapLayout;
  setKey?: string;
  onMore?: (side: Side) => void;
  /** Fills the full view, rather than sitting in the page */
  full?: boolean;
  onExpand?: () => void;
  expandRef?: React.Ref<HTMLButtonElement>;
}) {
  const { map, layout } = props;
  const summaryOf = useSummaryLookup(props.setKey);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [overflows, setOverflows] = React.useState(false);
  const { ref, dragging, handlers } = useDragToPan(overflows);

  const trace = React.useMemo(
    () => (hovered && hovered !== map.center.id ? getPathToCenter(map, hovered) : null),
    [map, hovered],
  );

  const centerView = React.useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const element = ref.current;
      if (!element) return;
      element.scrollTo({
        left: layout.center.x + layout.center.width / 2 - element.clientWidth / 2,
        top: layout.center.y + layout.center.height / 2 - element.clientHeight / 2,
        behavior,
      });
    },
    [layout, ref],
  );

  // Opens on the entity itself, and notices when the map outgrows its frame
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflows(
        element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
      );
    measure();
    centerView();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout, centerView, ref]);

  const showExpand = !props.full && overflows && props.onExpand;

  return (
    <div className={props.full ? "h-full" : undefined}>
      <div className={`relative ${props.full ? "h-full" : ""}`}>
        <div
          ref={ref}
          {...handlers}
          data-dependency-map={props.full ? "full" : ""}
          style={{
            maxHeight: props.full ? undefined : VIEWPORT_HEIGHT,
            backgroundImage: "radial-gradient(var(--mv-color-border) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
          className={[
            "overflow-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            props.full ? "h-full bg-elevated/40" : "rounded-xl border border-border bg-elevated/40",
            overflows ? (dragging ? "cursor-grabbing select-none" : "cursor-grab") : "",
          ].join(" ")}
        >
          {/* Auto margins centre a map smaller than its frame, and never clip a larger one */}
          <div className="flex min-h-full min-w-full">
            <div
              className="relative m-auto shrink-0"
              style={{ width: layout.width, height: layout.height }}
            >
              {layout.labels.map((label) => (
                <div
                  key={label.x}
                  className="absolute text-center text-[10px] font-semibold uppercase tracking-wider text-faint"
                  style={{ left: label.x, top: PADDING - 4, width: label.width }}
                >
                  {label.text}
                </div>
              ))}

              <svg
                aria-hidden="true"
                width={layout.width}
                height={layout.height}
                className="pointer-events-none absolute inset-0"
              >
                {map.edges.map((edge) => {
                  const from = layout.positions.get(edge.from);
                  const to = layout.positions.get(edge.to);
                  if (!from || !to) return null;
                  const id = `${edge.from}>${edge.to}`;
                  const lit = trace?.edges.has(id);
                  return (
                    <path
                      key={id}
                      d={edgePath(from, to)}
                      fill="none"
                      strokeWidth={lit ? 2 : 1.5}
                      strokeLinecap="round"
                      className={[
                        "transition-[stroke,opacity] duration-200",
                        lit ? "stroke-slate-500" : "stroke-slate-300",
                        trace && !lit ? "opacity-30" : "",
                      ].join(" ")}
                    />
                  );
                })}
                {/* Ports where lines meet each entity */}
                {layout.nodes.concat(layout.center).flatMap((node) => {
                  const dimmed = trace && !trace.nodes.has(node.id);
                  const ports = [];
                  const y = node.y + node.height / 2;
                  if (map.edges.some((edge) => edge.from === node.id)) {
                    ports.push(node.x + node.width);
                  }
                  if (map.edges.some((edge) => edge.to === node.id)) ports.push(node.x);
                  return ports.map((x) => (
                    <circle
                      key={`${node.id}@${x}`}
                      cx={x}
                      cy={y}
                      r={3}
                      className={[
                        "fill-surface stroke-slate-400 transition-opacity duration-200",
                        dimmed ? "opacity-30" : "",
                      ].join(" ")}
                      strokeWidth={1.5}
                    />
                  ));
                })}
              </svg>

              {layout.nodes.map((node) => (
                <MapNode
                  key={node.id}
                  node={node}
                  summary={summaryOf(node)}
                  setKey={props.setKey}
                  dimmed={Boolean(trace && !trace.nodes.has(node.id))}
                  lit={hovered === node.id}
                  onHover={setHovered}
                />
              ))}

              <div
                className="absolute flex flex-col justify-center rounded-lg border border-header-active bg-header-active px-3 text-header-text shadow-md"
                style={{
                  left: layout.center.x,
                  top: layout.center.y,
                  width: layout.center.width,
                  height: layout.center.height,
                }}
                title={layout.center.key}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                  {typeName(layout.center)}
                </span>
                <span className="truncate text-sm font-semibold">{layout.center.key}</span>
              </div>

              {/* The lists below the map name every entity, including those it leaves out */}
              {layout.more.map((item) => (
                <button
                  key={item.side}
                  type="button"
                  onClick={() => props.onMore?.(item.side)}
                  className="absolute flex cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-300 bg-surface text-xs font-medium text-muted outline-none hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ left: item.x, top: item.y, width: item.width, height: MORE_HEIGHT }}
                >
                  {item.count} more below
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* In the frame's corner, outside what scrolls, so they stay put while the map moves */}
        {overflows && (
          <div className="absolute bottom-2 right-2 flex gap-1">
            <button
              type="button"
              onClick={() => centerView("smooth")}
              aria-label={`Centre the map on ${map.center.key}`}
              title="Centre"
              className={cornerControlClass}
            >
              <CentreIcon />
            </button>
            {showExpand && (
              <button
                ref={props.expandRef}
                type="button"
                onClick={props.onExpand}
                aria-label="Open the map in a full view"
                title="Full view"
                className={cornerControlClass}
              >
                <ExpandIcon />
              </button>
            )}
          </div>
        )}
      </div>

      {!props.full && overflows && (
        <p className="mt-1.5 text-right text-[11px] text-faint">Drag to explore</p>
      )}
    </div>
  );
}

function MapNode(props: {
  node: PlacedNode;
  summary?: EntitySummary;
  setKey?: string;
  dimmed: boolean;
  lit: boolean;
  onHover: (id: string | null) => void;
}) {
  const { node, summary } = props;
  const status = summary?.archived ? "archived" : summary?.deprecated ? "deprecated" : undefined;
  const description = summary?.description ? `\n${summary.description}` : "";

  return (
    <Link
      to={getEntityRoute(node.type, node.key, props.setKey)}
      draggable={false}
      title={`${node.key}${description}`}
      onMouseEnter={() => props.onHover(node.id)}
      onMouseLeave={() => props.onHover(null)}
      onFocus={() => props.onHover(node.id)}
      onBlur={() => props.onHover(null)}
      className={[
        "absolute flex flex-col justify-center rounded-lg border bg-surface px-3 shadow-sm outline-none transition-[opacity,border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-primary",
        props.lit ? "border-slate-400 shadow-md" : "border-border hover:border-slate-400",
        props.dimmed ? "opacity-40" : "",
        summary?.archived ? "border-dashed" : "",
      ].join(" ")}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {typeName(node)}
        {status && (
          <span className={status === "deprecated" ? "text-amber-800" : ""}>· {status}</span>
        )}
      </span>
      <span className="truncate text-sm font-medium text-text">{node.key}</span>
    </Link>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path
        d="M9.75 2.25h4v4M6.25 13.75h-4v-4M13.75 2.25L9.5 6.5M2.25 13.75L6.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CentreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
