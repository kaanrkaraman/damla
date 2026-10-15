export const ICONS = {
  down: '<path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3l1.5 1.5h6.5A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
  retry: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2"/>',
  sliders: '<path d="M3.5 6H7M11 6h5.5M3.5 14H10M14 14h2.5"/><circle cx="9" cy="6" r="2"/><circle cx="12" cy="14" r="2"/>',
  back: '<path d="M12 4 6 10l6 6"/>',
  alert: '<circle cx="10" cy="10" r="7.5"/><path d="M10 6.2v4.6M10 13.6v.01"/>',
  film: '<rect x="3.5" y="5" width="13" height="10" rx="2"/><path d="M8.5 8.2v3.6l3-1.8z" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof ICONS;

type Prop = string | number | boolean | null | undefined | ((event: Event) => void);
type Child = Node | string | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, Prop> = {},
  ...kids: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = String(value);
    else if (typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, String(value));
  }
  node.append(...kids.flat().filter((kid): kid is Node | string => kid != null && kid !== false));
  return node;
}

export function svg(inner: string, className = "ic", box = 20): SVGSVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", `0 0 ${box} ${box}`);
  node.setAttribute("class", className);
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = inner;
  return node;
}

export const icon = (name: IconName, className?: string): SVGSVGElement => svg(ICONS[name], className);
