import { closeTab, newDocument, switchTab } from "../actions";
import { useStore } from "../model/store";

/** One tab per open document. */
export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const name = useStore((s) => s.name);
  const dirty = useStore((s) => s.dirty);
  const saveState = useStore((s) => s.saveState);

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t, i) => {
        const isActive = i === active;
        const label = isActive ? name : t.name;
        const unsaved = isActive ? dirty || saveState === "error" : t.dirty;
        return (
          <div
            key={i}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? " active" : ""}`}
            title={(isActive ? useStore.getState().filePath : t.filePath) ?? label}
            onClick={() => void switchTab(i)}
            onAuxClick={(e) => {
              if (e.button === 1) void closeTab(i);
            }}
          >
            <span className="tab-name">{label}</span>
            {unsaved && <span className="tab-dot" title="Not saved yet" />}
            <button
              className="tab-close"
              title="Close tab (⌘W)"
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(i);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="tab-new" title="New tab (⌘T)" onClick={() => void newDocument()}>
        +
      </button>
    </div>
  );
}
