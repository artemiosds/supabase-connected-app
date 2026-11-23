import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import "./primus-motion.css";

/**
 * Adaptação institucional de AnimatedList (React Bits).
 * Mantém semântica de lista e ações nativas, sem captura de clique do usuário.
 */
type AnimatedListProps<T extends { id: string }> = {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  ariaLabel: string;
  className?: string;
  maxHeight?: number;
};

export function AnimatedList<T extends { id: string }>({
  items,
  renderItem,
  ariaLabel,
  className = "",
  maxHeight = 540,
}: AnimatedListProps<T>) {
  const viewportRef = useRef<HTMLUListElement>(null);
  const [fades, setFades] = useState({ top: false, bottom: false });

  const syncFades = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = {
      top: viewport.scrollTop > 3,
      bottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 3,
    };
    setFades((previous) =>
      previous.top === next.top && previous.bottom === next.bottom ? previous : next,
    );
  }, []);

  useEffect(() => {
    syncFades();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncFades);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [items, syncFades]);

  const style = {
    "--primus-list-max-height": `${maxHeight}px`,
  } as CSSProperties;

  return (
    <div className={`primus-animated-list ${className}`.trim()} style={style}>
      {fades.top && (
        <div
          className="primus-animated-list__fade primus-animated-list__fade--top"
          aria-hidden="true"
        />
      )}
      <ul
        ref={viewportRef}
        aria-label={ariaLabel}
        className="primus-animated-list__viewport divide-y divide-border/65"
        onScroll={syncFades}
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            className="primus-animated-list__row"
            style={{ "--primus-row-delay": `${Math.min(index, 8) * 45}ms` } as CSSProperties}
          >
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
      {fades.bottom && (
        <div
          className="primus-animated-list__fade primus-animated-list__fade--bottom"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Adaptação do FlowingMenu (React Bits), sem imagens genéricas ou animação contínua. */
export type FlowingMenuItem = {
  id: string;
  text: string;
  description: string;
  href: string;
  icon: LucideIcon;
  featured?: boolean;
};

export function FlowingMenu({
  items,
  ariaLabel = "Ações rápidas",
}: {
  items: readonly FlowingMenuItem[];
  ariaLabel?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(-1);
  const [band, setBand] = useState({ top: 0, height: 0 });

  const measure = useCallback((index: number) => {
    const row = listRef.current?.children.item(index);
    if (!(row instanceof HTMLElement)) return;
    setBand((previous) =>
      previous.top === row.offsetTop && previous.height === row.offsetHeight
        ? previous
        : { top: row.offsetTop, height: row.offsetHeight },
    );
  }, []);

  useEffect(() => {
    if (active < 0) return;
    measure(active);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(active));
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [active, items, measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const links = listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-flowing-action]");
    if (!links?.length) return;
    event.preventDefault();
    const current = Array.from(links).findIndex((link) => link === document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + links.length) % links.length
            : (current - 1 + links.length) % links.length;
    links[next]?.focus();
  };

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={ariaLabel}
      className="primus-flowing-menu"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(-1);
      }}
      onPointerLeave={() => {
        if (!listRef.current?.contains(document.activeElement)) setActive(-1);
      }}
    >
      <span
        className="primus-flowing-menu__band"
        aria-hidden="true"
        data-visible={active >= 0}
        style={{ transform: `translate3d(0, ${band.top}px, 0)`, height: band.height }}
      />
      <ul ref={listRef} className="primus-flowing-menu__list">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <li key={item.id} className="primus-flowing-menu__row" data-active={active === index}>
              <a
                data-flowing-action
                href={item.href}
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                className="primus-flowing-menu__link"
              >
                <span
                  className={`primus-flowing-menu__icon ${item.featured ? "primus-flowing-menu__icon--featured" : ""}`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="primus-flowing-menu__text">
                  <span className="block text-sm font-semibold">{item.text}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <ArrowUpRight className="primus-flowing-menu__arrow size-4" aria-hidden="true" />
                <span className="primus-flowing-menu__marquee" aria-hidden="true">
                  <span>
                    {item.text} · {item.text} · {item.text} ·
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
