import * as React from "react";
import { Link, useLocation, useNavigate, useSearchParams, type To } from "react-router-dom";

import { fetchEntityDetail, peekEntityDetail, prefetchEntityDetail } from "../api";
import {
  getDependencyMap,
  getRevealedLimits,
  showsMoreThanAtFirst,
  type DependencyMap,
  type DependencyMapNode,
  type DependencyMapSide,
} from "../dependencyMap";
import { getEntityRoute, parseEntityPathname } from "../entityTypes";
import type { CatalogEntityType, EntityDetail, EntitySummary } from "../types";
import { useCatalogIndex } from "../useCatalogIndex";
import { typeName, useSummaryLookup } from "./dependencies";
import {
  ExpandIcon,
  FULL_VIEW_VALUE,
  FullViewDialog,
  isMac,
  toSearch,
  useFocusOnClose,
  useFullView,
} from "./fullView";

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
/** `?map=full` on an entity's Usage tab opens the full view */
export const FULL_VIEW_PARAM = "map";
/**
 * `?more=` keeps how much the reader asked to see, as a number of asks or `all`, so a link shows
 * the map as they left it. One value is for both sides, and two are for what it depends on and
 * what depends on it, as in `more=1,0`.
 */
export const MORE_PARAM = "more";
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
  /** Under a side's outermost column: showing what it leaves out, and going back */
  pills: Array<{
    side: Side;
    label: string;
    reveal: boolean;
    x: number;
    y: number;
    width: number;
    column: number;
  }>;
  labels: Array<{ text: string; x: number; width: number }>;
}

type Side = DependencyMapSide;

/** How many times the reader asked to see more on each side */
type Revealed = Record<Side, number>;
const NOTHING_REVEALED: Revealed = { dependencies: 0, dependents: 0 };

/** Reads `?more=`. Anything it cannot read counts as nothing asked for. */
export function parseRevealed(value: string | null): Revealed {
  const [dependencies = "", dependents = dependencies] = (value || "").split(",");
  const step = (text: string) => {
    if (text === "all") return Infinity;
    const asks = Number(text);
    return Number.isInteger(asks) && asks > 0 ? asks : 0;
  };
  return { dependencies: step(dependencies), dependents: step(dependents) };
}

/** Writes `?more=`, or nothing once the map is back to how it opens */
export function formatRevealed(revealed: Revealed) {
  const [dependencies, dependents] = [revealed.dependencies, revealed.dependents].map((step) =>
    step === Infinity ? "all" : String(step),
  );
  if (dependencies === "0" && dependents === "0") return undefined;
  return dependencies === dependents ? dependencies : `${dependencies},${dependents}`;
}

/** A side's pills show more of it, or take it back to what it showed at first */
function revealSide(revealed: Revealed, side: Side, more: boolean): Revealed {
  return { ...revealed, [side]: more ? revealed[side] + 1 : 0 };
}

const EVERYTHING_REVEALED: Revealed = { dependencies: Infinity, dependents: Infinity };

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

  // The outermost column on a side ends with a way to see what the map leaves out, and once
  // it shows more than at first, a way back
  const pillsOf = (column: MapColumn) => {
    if (column.side === undefined || column.index !== map[column.side].length - 1) return [];
    const count = map.more[column.side];
    return [
      ...(count > 0 ? [{ label: `Show ${count} more`, reveal: true }] : []),
      ...(showsMoreThanAtFirst(map[column.side]) ? [{ label: "Show fewer", reveal: false }] : []),
    ];
  };
  const columnHeight = (column: MapColumn) =>
    column.side === undefined
      ? CENTER_HEIGHT
      : column.nodes.length * NODE_HEIGHT +
        (column.nodes.length - 1) * ROW_GAP +
        pillsOf(column).length * (ROW_GAP + MORE_HEIGHT);
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
  const pills: MapLayout["pills"] = [];
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
    for (const pill of pillsOf(column)) {
      pills.push({ ...pill, side: column.side, x, y, width, column: columnIndex });
      y += MORE_HEIGHT + ROW_GAP;
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
  for (const pill of pills) pill.x = offsets[pill.column];

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
    pills,
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

/**
 * One entity's dependency map, undefined without an entity or when it has no dependencies and no
 * dependents, and how much of each side the reader has asked to see. That lives in the URL as
 * `?more=`, so a link shows the map as the reader left it, and moving to another entity starts
 * afresh.
 */
export function useDependencyMap(detail: EntityDetail | null | undefined, setKey?: string) {
  const { index } = useCatalogIndex(setKey);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const asked = searchParams.get(MORE_PARAM);
  const revealed = React.useMemo(() => parseRevealed(asked), [asked]);
  const map = React.useMemo(
    () =>
      detail
        ? getDependencyMap(detail, index, {
            dependencies: getRevealedLimits(revealed.dependencies),
            dependents: getRevealedLimits(revealed.dependents),
          })
        : undefined,
    [detail, index, revealed],
  );

  // Replaces the history entry, so Back leaves the page rather than retracing the map. The new
  // entry has no way back for the full view, so closing it keeps what the reader asked to see.
  const setRevealed = React.useCallback(
    (next: Revealed) => {
      const params = new URLSearchParams(location.search);
      const value = formatRevealed(next);
      if (value) params.set(MORE_PARAM, value);
      else params.delete(MORE_PARAM);
      navigate(
        {
          pathname: location.pathname,
          search: toSearch(params),
          hash: location.hash,
        },
        { replace: true },
      );
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  return { map, revealed, setRevealed };
}

/**
 * What an entity depends on and what depends on it, drawn as a map: the entity in the middle,
 * its dependencies to the left and its dependents to the right, a column for each step away.
 * Hovering an entity traces its way to the middle. A map larger than its frame drags, and opens
 * in a full view that takes most of the window, `DependencyMapFullView`.
 */
export function DependencyMapView(props: {
  map: DependencyMap;
  setKey?: string;
  /** How many times each side has been asked to show more */
  revealed?: Revealed;
  onRevealedChange?: (next: Revealed) => void;
}) {
  const revealed = props.revealed ?? NOTHING_REVEALED;
  const layout = React.useMemo(() => layoutMap(props.map), [props.map]);
  const expandRef = React.useRef<HTMLButtonElement | null>(null);
  const { expanded, open } = useFullView(FULL_VIEW_PARAM);
  useFocusOnClose(expanded, () => expandRef.current?.focus());

  return (
    <MapCanvas
      map={props.map}
      layout={layout}
      setKey={props.setKey}
      onReveal={(side, more) => props.onRevealedChange?.(revealSide(revealed, side, more))}
      onExpand={open}
      expandRef={expandRef}
    />
  );
}

/** An entity's detail, from the cache at once when it is there, or once it loads */
function useEntityDetailOf(type?: CatalogEntityType, key?: string, setKey?: string) {
  const id = type && key ? `${setKey ?? ""}\u0000${type}:${key}` : undefined;
  const cached = React.useMemo(
    () => (type && key ? peekEntityDetail(type, key, setKey) : undefined),
    [type, key, setKey],
  );
  const [loaded, setLoaded] = React.useState<{
    id: string;
    detail?: EntityDetail;
    failed?: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (!type || !key || !id || cached) return;
    let active = true;
    fetchEntityDetail(type, key, setKey).then(
      (detail) => active && setLoaded({ id, detail }),
      () => active && setLoaded({ id, failed: true }),
    );
    return () => {
      active = false;
    };
  }, [type, key, setKey, id, cached]);

  const mine = loaded?.id === id ? loaded : undefined;
  return { detail: cached ?? mine?.detail ?? null, failed: Boolean(mine?.failed) };
}

/**
 * The dependency map's full view, opened by `?map=full` on an entity's Usage tab. It sits beside
 * the entity's view rather than in it, so it stays open while the page behind it moves: clicking
 * an entity in it opens that entity's Usage tab underneath and its map here, and Back and Forward
 * retrace the way. While the next entity loads, the map before it stays.
 */
export function DependencyMapFullView(props: {
  type?: CatalogEntityType;
  entityKey?: string;
  setKey?: string;
}) {
  const { type, entityKey, setKey } = props;
  const location = useLocation();
  const { expanded: asked, close } = useFullView(FULL_VIEW_PARAM);
  const tab = parseEntityPathname(location.pathname)?.tab;
  const expanded = asked && tab?.length === 1 && tab[0] === "usage";
  const { detail, failed } = useEntityDetailOf(expanded ? type : undefined, entityKey, setKey);
  const { map, revealed, setRevealed } = useDependencyMap(detail, setKey);

  // The last map shown, kept while the next one loads
  const [kept, setKept] = React.useState<DependencyMap | null>(null);
  if (map && kept !== map) setKept(map);
  if (!expanded && kept) setKept(null);
  const loading = expanded && !detail && !failed;
  const shownMap = map ?? (loading ? kept : null);
  const layout = React.useMemo(() => (shownMap ? layoutMap(shownMap) : undefined), [shownMap]);

  if (!expanded || !shownMap || !layout) return null;

  return (
    <FullViewDialog
      label={`Dependency map of ${shownMap.center.key}`}
      title="Dependency map"
      subtitle={`${typeName(shownMap.center)} ${shownMap.center.key}`}
      hint={`Drag to move, pinch or hold ${isMac() ? "⌘" : "Ctrl"} and scroll to zoom`}
      onClose={close}
    >
      <MapCanvas
        map={shownMap}
        layout={layout}
        setKey={setKey}
        onReveal={(side, more) => setRevealed(revealSide(revealed, side, more))}
        onRevealAll={(all) => setRevealed(all ? EVERYTHING_REVEALED : NOTHING_REVEALED)}
        busy={!map}
        full
      />
    </FullViewDialog>
  );
}

/** Zoom levels the buttons and keys step through. A pinch can land between them. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

function nextZoomStep(zoom: number, direction: 1 | -1) {
  return direction > 0
    ? (ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM)
    : ([...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? MIN_ZOOM);
}

const zoomStepClass =
  "flex w-6 cursor-pointer items-center justify-center outline-none hover:bg-slate-100 hover:text-text focus-visible:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent [&>svg]:h-3 [&>svg]:w-3";

/** The map's own controls, smaller than the close button so they sit quietly in its corner */
const cornerControlClass =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-muted shadow-sm outline-none transition-colors hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary [&>svg]:h-3 [&>svg]:w-3";

/** The map itself: its scrolling frame, what it draws, and the controls in its corner */
function MapCanvas(props: {
  map: DependencyMap;
  layout: MapLayout;
  setKey?: string;
  /** Shows more of a side, or goes back to what it showed at first */
  onReveal?: (side: Side, more: boolean) => void;
  /** Shows everything the map leaves out on both sides, or goes back to how it opened */
  onRevealAll?: (all: boolean) => void;
  /** Fills the full view, rather than sitting in the page. Its entities open their own maps. */
  full?: boolean;
  /** Still shows the map before while the next one loads */
  busy?: boolean;
  onExpand?: () => void;
  expandRef?: React.Ref<HTMLButtonElement>;
}) {
  const { map, layout, full } = props;
  const summaryOf = useSummaryLookup(props.setKey);
  // What the pointer or focus is on, forgotten when the map moves to another entity
  const [hover, setHover] = React.useState<{ center: string; id: string } | null>(null);
  const hovered = hover?.center === map.center.id ? hover.id : null;
  const setHovered = React.useCallback(
    (id: string | null) => setHover(id ? { center: map.center.id, id } : null),
    [map.center.id],
  );
  const [overflows, setOverflows] = React.useState(false);
  const { ref, dragging, handlers } = useDragToPan(overflows);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  // Zoom, in the full view only. The box around the map grows and shrinks with it, so scrolling
  // reaches every edge at any zoom, and the map inside is scaled to fill the box.
  const [zoom, setZoom] = React.useState(1);
  /** The zoom on the page, which a quick run of pinch events can be ahead of */
  const shownZoom = React.useRef(1);
  const targetZoom = React.useRef(1);
  /** The point of the map that stays put while zooming: under the pointer, or the middle */
  const anchor = React.useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(
    null,
  );

  const trace = React.useMemo(
    () => (hovered && hovered !== map.center.id ? getPathToCenter(map, hovered) : null),
    [map, hovered],
  );

  const measure = React.useCallback(() => {
    const element = ref.current;
    if (!element) return;
    setOverflows(
      element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1,
    );
  }, [ref]);

  // Where the entity sat in the frame when last drawn or scrolled, so it can stay there
  const centerRef = React.useRef<HTMLDivElement | null>(null);
  const centerSpot = React.useRef<{ x: number; y: number } | null>(null);
  const rememberCenter = React.useCallback(() => {
    const element = ref.current;
    const node = centerRef.current;
    if (!element || !node) return;
    const frame = element.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    centerSpot.current = { x: box.left - frame.left, y: box.top - frame.top };
  }, [ref]);

  /** Where on screen the entity clicked in the full view sat, so its own map can come from there */
  const arrival = React.useRef<{ x: number; y: number } | null>(null);
  const shownCenter = React.useRef(map.center.id);

  const rememberArrival = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // A click that opens a new tab or window leaves this map as it is
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    arrival.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };

  // Another entity's map slides in from where the reader clicked that entity, settling with it in
  // the middle, so the move reads as a step through the project. Focus, lost with the clicked
  // entity, goes to the new one in the middle so the keyboard can carry on from there.
  const arrive = React.useCallback(() => {
    const from = arrival.current;
    arrival.current = null;
    const box = boxRef.current;
    const node = centerRef.current;
    if (!box || !node) return;
    if (full && (!document.activeElement || document.activeElement === document.body)) {
      node.focus({ preventScroll: true });
    }
    if (typeof box.animate !== "function" || prefersReducedMotion()) return;
    const placed = node.getBoundingClientRect();
    const dx = from ? from.x - (placed.left + placed.width / 2) : 0;
    const dy = from ? from.y - (placed.top + placed.height / 2) : 0;
    box.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.4 },
        { transform: "translate(0, 0)", opacity: 1 },
      ],
      { duration: from ? 360 : 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [full]);

  const centerView = React.useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const element = ref.current;
      const box = boxRef.current;
      if (!element || !box) return;
      const frame = element.getBoundingClientRect();
      const placed = box.getBoundingClientRect();
      const scale = shownZoom.current;
      element.scrollBy({
        left:
          placed.left +
          (layout.center.x + layout.center.width / 2) * scale -
          (frame.left + element.clientLeft + element.clientWidth / 2),
        top:
          placed.top +
          (layout.center.y + layout.center.height / 2) * scale -
          (frame.top + element.clientTop + element.clientHeight / 2),
        behavior,
      });
    },
    [layout, ref],
  );

  const zoomTo = React.useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const element = ref.current;
      const box = boxRef.current;
      const zoomed = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (!element || !box || Math.abs(zoomed - targetZoom.current) < 0.001) return;
      if (!anchor.current) {
        const frame = element.getBoundingClientRect();
        const placed = box.getBoundingClientRect();
        const x = clientX ?? frame.left + element.clientLeft + element.clientWidth / 2;
        const y = clientY ?? frame.top + element.clientTop + element.clientHeight / 2;
        anchor.current = {
          x: (x - placed.left) / shownZoom.current,
          y: (y - placed.top) / shownZoom.current,
          clientX: x,
          clientY: y,
        };
      }
      targetZoom.current = zoomed;
      setZoom(zoomed);
    },
    [ref],
  );

  // Once the new zoom is on the page, scrolls so the anchored point is back where it was
  React.useLayoutEffect(() => {
    shownZoom.current = zoom;
    const element = ref.current;
    const box = boxRef.current;
    const point = anchor.current;
    anchor.current = null;
    if (element && box && point) {
      const placed = box.getBoundingClientRect();
      element.scrollLeft += placed.left + point.x * zoom - point.clientX;
      element.scrollTop += placed.top + point.y * zoom - point.clientY;
      // only after a zoom, since on opening the map has not been centred yet
      rememberCenter();
    }
    measure();
  }, [zoom, measure, rememberCenter, ref]);

  // Opens on the entity itself, as does another entity's map. When the map changes under the same
  // entity, as when a side shows more, the entity stays where it was, so the reader keeps their
  // place. It also notices when the map outgrows its frame.
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    const moved = shownCenter.current !== map.center.id;
    shownCenter.current = map.center.id;
    const spot = moved ? null : centerSpot.current;
    const node = centerRef.current;
    if (spot && node) {
      const frame = element.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      element.scrollBy(box.left - frame.left - spot.x, box.top - frame.top - spot.y);
    } else centerView();
    rememberCenter();
    if (moved) arrive();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout, map.center.id, arrive, centerView, measure, rememberCenter, ref]);

  // In the full view, a pinch or Ctrl or ⌘ with the wheel zooms around the pointer, and +, −
  // and 0 zoom around the middle. A plain wheel still scrolls.
  React.useEffect(() => {
    const element = ref.current;
    if (!full || !element) return;
    function onWheel(event: WheelEvent) {
      // A pinch on a trackpad arrives as a wheel with Ctrl held
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomTo(targetZoom.current * Math.exp(-delta * 0.002), event.clientX, event.clientY);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") zoomTo(nextZoomStep(targetZoom.current, 1));
      else if (event.key === "-" || event.key === "_") {
        zoomTo(nextZoomStep(targetZoom.current, -1));
      } else if (event.key === "0") zoomTo(1);
      else return;
      event.preventDefault();
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [full, zoomTo, ref]);

  const percent = Math.round(zoom * 100);
  // For the full view's control showing or hiding everything at once
  const hidden = map.more.dependencies + map.more.dependents;
  const grown = showsMoreThanAtFirst(map.dependencies) || showsMoreThanAtFirst(map.dependents);
  const showExpand = !full && overflows && props.onExpand;

  return (
    <div className={full ? "h-full" : undefined}>
      <div className={`relative ${full ? "h-full" : ""}`}>
        <div
          ref={ref}
          {...handlers}
          onScroll={rememberCenter}
          data-dependency-map={full ? "full" : ""}
          aria-busy={props.busy || undefined}
          style={{
            maxHeight: full ? undefined : VIEWPORT_HEIGHT,
            backgroundImage: "radial-gradient(var(--mv-color-border) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
          className={[
            "overflow-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            full ? "h-full bg-elevated/40" : "rounded-xl border border-border bg-elevated/40",
            overflows ? (dragging ? "cursor-grabbing select-none" : "cursor-grab") : "",
          ].join(" ")}
        >
          {/* Auto margins centre a map smaller than its frame, and never clip a larger one. A map
              still showing while the next loads dims, unless the next comes quickly. */}
          <div
            className={[
              "flex min-h-full min-w-full transition-opacity",
              props.busy ? "opacity-50 delay-150 duration-300" : "duration-150",
            ].join(" ")}
          >
            <div
              ref={boxRef}
              className="relative m-auto shrink-0"
              style={{ width: layout.width * zoom, height: layout.height * zoom }}
            >
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: zoom === 1 ? undefined : `scale(${zoom})`,
                }}
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
                    to={
                      full
                        ? {
                            pathname: `${getEntityRoute(node.type, node.key, props.setKey)}/usage`,
                            search: `?${FULL_VIEW_PARAM}=${FULL_VIEW_VALUE}`,
                          }
                        : getEntityRoute(node.type, node.key, props.setKey)
                    }
                    onOpen={full ? rememberArrival : undefined}
                    summary={summaryOf(node)}
                    setKey={props.setKey}
                    dimmed={Boolean(trace && !trace.nodes.has(node.id))}
                    lit={hovered === node.id}
                    onHover={setHovered}
                  />
                ))}

                <div
                  ref={centerRef}
                  tabIndex={full ? -1 : undefined}
                  className="absolute flex flex-col justify-center rounded-lg border border-header-active bg-header-active px-3 text-header-text shadow-md outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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

                {layout.pills.map((pill) => (
                  <button
                    key={`${pill.side}:${pill.reveal}`}
                    type="button"
                    onClick={() => props.onReveal?.(pill.side, pill.reveal)}
                    className="absolute flex cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-300 bg-surface text-xs font-medium text-muted outline-none hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
                    style={{ left: pill.x, top: pill.y, width: pill.width, height: MORE_HEIGHT }}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* In the frame's corner, outside what scrolls, so they stay put while the map moves */}
        {(full || overflows) && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {props.onRevealAll && (hidden > 0 || grown) && (
              <button
                type="button"
                onClick={() => props.onRevealAll?.(hidden > 0)}
                aria-label={
                  hidden > 0 ? `Show all ${hidden} hidden entities` : "Show the map as it opened"
                }
                title={hidden > 0 ? `Show everything (${hidden} more)` : "Show fewer"}
                className={cornerControlClass}
              >
                {hidden > 0 ? <UnfoldIcon /> : <FoldIcon />}
              </button>
            )}
            {full && (
              <div
                role="group"
                aria-label="Zoom"
                className="flex h-6 items-stretch overflow-hidden rounded-md border border-border bg-surface text-muted shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => zoomTo(nextZoomStep(targetZoom.current, -1))}
                  disabled={zoom <= MIN_ZOOM + 0.001}
                  aria-label="Zoom out"
                  title="Zoom out (−)"
                  className={zoomStepClass}
                >
                  <MinusIcon />
                </button>
                <button
                  type="button"
                  onClick={() => zoomTo(1)}
                  aria-label={`Zoom ${percent}%, reset to 100%`}
                  title="Reset to 100% (0)"
                  className="min-w-11 cursor-pointer border-x border-border px-1.5 text-[11px] font-medium tabular-nums outline-none hover:bg-slate-100 hover:text-text focus-visible:bg-slate-100"
                >
                  {percent}%
                </button>
                <button
                  type="button"
                  onClick={() => zoomTo(nextZoomStep(targetZoom.current, 1))}
                  disabled={zoom >= MAX_ZOOM - 0.001}
                  aria-label="Zoom in"
                  title="Zoom in (+)"
                  className={zoomStepClass}
                >
                  <PlusIcon />
                </button>
              </div>
            )}
            {overflows && (
              <button
                type="button"
                onClick={() => centerView("smooth")}
                aria-label={`Centre the map on ${map.center.key}`}
                title="Centre"
                className={cornerControlClass}
              >
                <CentreIcon />
              </button>
            )}
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

      {!full && overflows && (
        <p className="mt-1.5 text-right text-[11px] text-faint">Drag to explore</p>
      )}
    </div>
  );
}

function MapNode(props: {
  node: PlacedNode;
  /** The entity's page, or in the full view its Usage tab with its map open */
  to: To;
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  summary?: EntitySummary;
  setKey?: string;
  dimmed: boolean;
  lit: boolean;
  onHover: (id: string | null) => void;
}) {
  const { node, summary } = props;
  const status = summary?.archived ? "archived" : summary?.deprecated ? "deprecated" : undefined;
  const description = summary?.description ? `\n${summary.description}` : "";
  // Pointing at an entity starts loading it, so following it is quick
  const point = () => {
    props.onHover(node.id);
    prefetchEntityDetail(node.type, node.key, props.setKey);
  };

  return (
    <Link
      to={props.to}
      onClick={props.onOpen}
      draggable={false}
      title={`${node.key}${description}`}
      onMouseEnter={point}
      onMouseLeave={() => props.onHover(null)}
      onFocus={point}
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

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Arrows apart, for showing everything */
function UnfoldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="M5 6.5l3-3 3 3M5 9.5l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Arrows together, for going back to how the map opened */
function FoldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="M5 3.5l3 3 3-3M5 12.5l3-3 3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
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
