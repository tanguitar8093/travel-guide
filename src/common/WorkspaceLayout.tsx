import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { RouterLink } from "../router";
import { routes } from "../routes";
import "./WorkspaceLayout.css";

type WorkspaceSection = "regions" | "places" | "labels" | "itinerary" | "data";

interface WorkspaceLayoutProps {
  active: WorkspaceSection;
  children: ReactNode;
  counts?: Partial<Record<WorkspaceSection, number>>;
  mainClassName?: string;
  shellClassName?: string;
}

const navigationItems: {
  id: WorkspaceSection;
  label: string;
  icon: string;
  path: string;
}[] = [
  { id: "regions", label: "區域管理", icon: "◎", path: routes.regions },
  { id: "places", label: "地點", icon: "⌖", path: routes.places },
  { id: "labels", label: "標籤管理", icon: "◈", path: routes.labels },
  { id: "itinerary", label: "行程", icon: "▤", path: routes.itinerary },
  { id: "data", label: "資料管理", icon: "⇅", path: routes.dataManagement },
];

function isDesktopPointer(): boolean {
  return window.matchMedia(
    "(min-width: 761px) and (hover: hover) and (pointer: fine)",
  ).matches;
}

export function WorkspaceLayout({
  active,
  children,
  counts,
  mainClassName = "",
  shellClassName = "",
}: WorkspaceLayoutProps) {
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarOpen = sidebarPinned || sidebarHovered;

  function cancelScheduledClose() {
    if (closeTimer.current !== undefined) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }

  function scheduleClose() {
    if (closeTimer.current !== undefined) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setSidebarHovered(false);
    }, 180);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarPinned(false);
        setSidebarHovered(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!sidebarOpen || isDesktopPointer()) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => () => cancelScheduledClose(), []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!isDesktopPointer() || sidebarPinned) return;
      const pointerInside = [sidebarRef.current, toggleRef.current].some(
        (element) => {
          if (!element) return false;
          const bounds = element.getBoundingClientRect();
          return (
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom
          );
        },
      );

      if (pointerInside) {
        cancelScheduledClose();
        if (!sidebarHovered) setSidebarHovered(true);
      } else if (sidebarHovered) {
        scheduleClose();
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [sidebarHovered, sidebarPinned]);

  function closeOnMobileNavigation() {
    if (!isDesktopPointer()) {
      setSidebarPinned(false);
      setSidebarHovered(false);
    }
  }

  function toggleSidebar() {
    cancelScheduledClose();
    if (!isDesktopPointer()) {
      setSidebarPinned((open) => !open);
      setSidebarHovered(false);
      return;
    }

    setSidebarPinned(!sidebarPinned);
    if (sidebarPinned) setSidebarHovered(false);
  }

  return (
    <div
      className={`workspace-layout ${shellClassName}`.trim()}
      data-sidebar-open={sidebarOpen}
    >
      {!isDesktopPointer() && sidebarOpen && (
        <button
          className="workspace-sidebar-backdrop"
          type="button"
          aria-label="關閉導覽側欄"
          onClick={() => {
            setSidebarPinned(false);
            setSidebarHovered(false);
          }}
        />
      )}
      <aside
        id="workspace-sidebar"
        ref={sidebarRef}
        className="workspace-sidebar"
        aria-label="工作區側欄"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
      >
        <RouterLink
          className="workspace-brand"
          to={routes.regions}
          aria-label="首頁"
          onClick={closeOnMobileNavigation}
        >
          <span>
            <strong>行程規劃</strong>
            <small>TRAVEL PLANNER</small>
          </span>
        </RouterLink>
        <div className="workspace-nav-caption">工作區</div>
        <nav className="workspace-nav" aria-label="主要導覽">
          {navigationItems.map((item) => (
            <RouterLink
              key={item.id}
              to={item.path}
              className="workspace-nav-item"
              aria-current={active === item.id ? "page" : undefined}
              onClick={closeOnMobileNavigation}
            >
              <span className="workspace-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              {counts?.[item.id] !== undefined && (
                <span className="workspace-nav-count">{counts[item.id]}</span>
              )}
            </RouterLink>
          ))}
        </nav>
        <div className="workspace-sidebar-foot">資料儲存於此瀏覽器</div>
      </aside>

      <button
        ref={toggleRef}
        className="workspace-sidebar-toggle"
        type="button"
        aria-label={sidebarOpen ? "收合工作區側欄" : "展開工作區側欄"}
        aria-expanded={sidebarOpen}
        aria-controls="workspace-sidebar"
        onClick={toggleSidebar}
      >
        <span aria-hidden="true">☰</span>
      </button>

      <main className={`workspace-main ${mainClassName}`.trim()}>
        {children}
      </main>
    </div>
  );
}
